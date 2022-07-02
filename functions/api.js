import axios from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import * as functions from 'firebase-functions';

const jar = new CookieJar();
const client = wrapper(axios.create({ jar }));

const DEFAULT_HEADERS = {
	"Accept-Encoding": "gzip, deflate, br",
	"Accept-Language": "it",
	"Channel": "41",
	"Connection": "keep-alive",
	"host": "app.lefrecce.it",
	"User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:99.0) Gecko/20100101 Firefox/99.0",
	"Referer": "https://www.lefrecce.it/Channels.Website.WEB/",
	"Origin": "https://www.lefrecce.it",
	"X-Requested-With": "Fetch",
	"whitelabel_referrer": "www.trenitalia.com",
	"CallerTimestamp": Date.now().toString()
};
const MOBILE_HEADERS = {
	"accept-encoding": "gzip",
	"accept-language": "it",
	"channel": "804",
	"client-version": "9.200.0.39533",
	"connection": "keep-alive",
	"host": "app.lefrecce.it",
	"user-agent": "okhttp/3.12.6",
	"cookie": "JSESSIONID=0000DF9XELJq3HHqtrQ3EF-zh3Q:1fu93tnra",
	"deviceplatform": "GOOGLE_ANDROID",
	"deviceplatformtoken": "dybzQT8CT4iDD8UWagBOEA:APA91bHYuzBmdq4KnSG0FUvPSQF16EQ0UMr5PlI1K8exoulZLhOiUonc91XwN6CC9g1MIOMj7tzuBx9B3F6DvCMUMJWawCK2GNup9vW6860Wu1b_D3shbLlLbt-1Vlv8TCAysAN4u-Ca",
	"customerdeviceid": "1739ab3787f3685dTrenitalia14ddf6c2-a307-4918-a1f3-cc6f8a9ea7a2"
};
const DESKTOP_URL = "https://www.lefrecce.it/Channels.Website.BFF.WEB/website/";
const MOBILE_URL = "https://app.lefrecce.it/Channels.AppApi/rest/";

const pairs = (arr) => {
    var _pairs = [];
    arr.forEach((el, i) => {
        if (i < arr.length - 1) {
            _pairs.push([el, arr[i + 1]]);
        }
    });
    return _pairs;
};

const consume = async (promises) => {
    var results = [];
    for (var p of promises) {
        try {
            results.push({
                status: "fulfilled",
                data: await new Promise((resolve, reject) => {
                    setTimeout(() => {
                        functions.logger.info("new promise");
                        p.then(res => resolve(res)).catch(e => reject(e));
                    }, 1000);
                })
            });
        } catch (e) {
            results.push({
                status: "rejected",
                error: e
            });
        }
    }
    return results;
};


class TrenitaliaSession {
	ok(response) {
		return response && response.status === 200 && response.statusText === 'OK';
	}

    ko(response) {
        return !this.ok(response);
    }

	async initialize() {
        this.session = client;
		return this.ok(await this.session.post(
			DESKTOP_URL + "whitelist/enabled", "{}", {
				headers: {
					...DEFAULT_HEADERS,
					"Content-Type": "application/json"
				}
			}
		));
	}

    async updateCart(cartId, solution) {
        var update = await this.session.get(
            DESKTOP_URL + "cart", {
                params: {
                    "cartId": cartId,
                    "currentSolutionId": solution.solution.id
                },
                headers: DEFAULT_HEADERS
            }
        );
        if (this.ko(update)) {
            functions.logger.error(`updateCart(${cartId}, ${solution}) failed with ${update.status}`);
            throw `updateCart(${cartId}, ${solution}): cart retrieval failed with ${update.status}`; 
        }
        if (solution.grids.length < 1) {
            functions.logger.info(`updateCart(${cartId}, ${solution}) failed as given solution as no grids`);
            throw `updateCart(${cartId}, ${solution}) failed as given solution as no grids`;
        }

        update = await this.session.post(
            DESKTOP_URL + `grid/${cartId}/update`, {
                upselling: false,
                solutionId: solution.solution.id,
                offeredServicesUpdate: [
                    {
                        offerKeys: solution.grids[0].services[0].offers[0].offerKeys,
                        travellers: solution.grids[0].services[0].offers[0].travellers
                    }
                ]
            }, {
                headers: {
                    ...DEFAULT_HEADERS,
                    "Content-Type": "application/json"
                }
            }
        );
        if (this.ko(update)) {
            functions.logger.error(`updateCart(${cartId}, ${solution}) failed with ${update.status}`);
            throw `updateCart(${cartId}, ${solution}): grid update failed with ${update.status}`; 
        }
        if (solution.grids.length < 1) {
            functions.logger.error(`updateCart(${cartId}, ${solution}) failed as given solution as no grids`);
            throw `updateCart(${cartId}, ${solution}): grid update failed with ${update.status}`;
        }
    }

    async getSeatmap(cartId, solutionId, nodeId) {
        let seatmap = await this.session.get(
            DESKTOP_URL + `seatmap/${cartId}`, {
                params: {
                    solutionId: solutionId,
                    nodeId: nodeId
                }, 
                headers: DEFAULT_HEADERS
            }
        );
        if (this.ko(seatmap)) {
            functions.logger.error(`getSeatmap(${cartId}, ${solutionId}) failed with ${seatmap.status}`);
            throw `getSeatmap(${cartId}, ${solutionId}) failed with ${seatmap.status}`;
        }
        return seatmap.data;
    }

    async findTravelSolutionForTrain(train, startLocationId, endLocationId) {
        for (let i = 0; i < 60; i += 10) {
            var solutions = await this.getTravelSolutions(startLocationId, endLocationId, i);
            this.cartId = solutions.cartId;
            for (var solution of solutions.solutions) {
                if (solution.solution.nodes.length != 1) {
                    continue;
                }
                if (train === solution.solution.trains[0].name) {
                    return solution;
                }
            }
        }
        return null;
    }

    async getRoute(trainNumber) {
        var service = await axios.get(
            MOBILE_URL + "transports", {
                params: {
                    transportName: parseInt(trainNumber)
                },
                headers: MOBILE_HEADERS
            }
        );
        if (this.ko(service)) {
            functions.logger.error(`getRoute#service(${trainNumber}) failed with ${service.status}`);
            throw `getRoute#service(${trainNumber}) failed with ${service.status}`;
        }
        service = service.data[0];
        let route = await axios.get(
            MOBILE_URL + "transports/caring", {
                params: {
                    transportMeanName: service.transportMeanName,
                    origin: service.startLocation.locationId,
                    departure_time: service.startTime
                },
                headers: MOBILE_HEADERS
            }
        );
        if (this.ko(route)) {
            functions.logger.error(`getRoute#route(${trainNumber}) failed with ${service.status}`);
            throw `getRoute#route(${trainNumber}) failed with ${service.status}`;
        }
        return route.data;
    }

    async getTravelSolutions(startLocationId, endLocationId, offset) {
        let solutions = await this.session.post(
            DESKTOP_URL + "ticket/solutions", {
                departureLocationId: startLocationId,
                arrivalLocationId: endLocationId,
                departureTime: (new Date()).toISOString(),
                adults: 1,
                children: 0,
                criteria: {
                    frecceOnly: false,
                    regionalOnly: false,
                    noChanges: false,
                    order: "DEPARTURE_DATE",
                    offset: offset,
                    limit: 10
                },
                advancedSearchRequest: {
                    bestFare: false
                }
            }, {
                headers: {
                    ...DEFAULT_HEADERS,
                    Channel: null,
                    "Content-Type": "application/json"
                }
            }
        );
        if (this.ko(solutions)) {
            functions.logger.error(`getTravelSolutions(${startLocationId}, ${endLocationId}) failed with ${solutions.status}`);
            throw `getTravelSolutions(${startLocationId}, ${endLocationId}) failed with ${solutions.status}`;
        }
        return solutions.data;
    }

    async getSeatsAvailabilityBetween(train, startLocationId, endLocationId) {
        let solution = await this.findTravelSolutionForTrain(train, startLocationId, endLocationId);
        if (solution) {
            if (!solution.canShowSeatMap) {
                functions.logger.warn(`getSeatsAvailabilityBetween(${startLocationId}, ${endLocationId}) failed as no seatmap is available for the selected train`);
                return null;
            }
            await this.updateCart(this.cartId, solution);
            var seatmap = await this.getSeatmap(
                this.cartId,
                solution.solution.id,
                solution.solution.nodes[0].id
            );
            return {
                seatmap: seatmap,
                solutionOrigin: solution.solution.origin,
                solutionDestination: solution.solution.destination,
                solutionDepartureTime: solution.solution.departureTime
            };
        } else {
            functions.logger.info(`getSeatsAvailabilityBetween(${train}, ${startLocationId}, ${endLocationId}): no train solution found`);
            return null;
        }
    }

    async getSeatAvailability(train, query) {
        let route = await this.getRoute(train);
        // return (await Promise.allSettled(pairs(route.stops)
        //     .map(pair => this.getSeatsAvailabilityBetween(
        //         train, pair[0].location.locationId, pair[1].location.locationId
        //     )))
        // ).sort((r1, r2) => {
        //     if (r1.status === "rejected") {
        //         return 1;
        //     }
        //     return r1.value.solutionDepartureTime.getTime() - 
        //         r2.value.solutionDepartureTime.getTime()
        // }).map(res => {
        //     if (res.status === "rejected") {
        //         return {
        //             from: res.value.solutionOrigin,
        //             to: res.value.solutionDestination,
        //             seats: null
        //         }
        //     }
        //     return {
        //         from: res.value.solutionOrigin,
        //         to: res.value.solutionDestination,
        //         seats: query.map(s => res.seatmap.wagons
        //             .find(wagon => wagon.id === s.coach)
        //             .seats
        //             .find(seat => seat.label === s.seat)
        //         )
        //     }
        // });
        return (await consume(pairs(route.stops)
            .map(pair => this.getSeatsAvailabilityBetween(
                train, pair[0].location.locationId, pair[1].location.locationId
            )))
        ).sort((r1, r2) => {
            if (r1.status === "rejected") {
                return 1;
            }
            return r1.value.solutionDepartureTime.getTime() - 
                r2.value.solutionDepartureTime.getTime()
        }).map(res => {
            if (res.status === "rejected") {
                return {
                    from: res.value.solutionOrigin,
                    to: res.value.solutionDestination,
                    seats: null
                }
            }
            return {
                from: res.value.solutionOrigin,
                to: res.value.solutionDestination,
                seats: query.map(s => res.seatmap.wagons
                    .find(wagon => wagon.id === s.coach)
                    .seats
                    .find(seat => seat.label === s.seat)
                )
            }
        });
    }

};

export { TrenitaliaSession };