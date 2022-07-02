import * as functions from 'firebase-functions';
import isvalid from 'isvalid';
import { TrenitaliaSession } from './api.js';


export const seat = functions.https.onRequest(async (req, res) => {
    var query = await isvalid(req.body, {
        'query': { 
            type: Object, 
            required: true, 
            schema: {
                'train': { type: String, required: true },
                'seats': { 
                    type: Array, 
                    required: true, 
                    schema: {
                        type: Object,
                        required: true,
                        schema: {
                            'seat': { type: String, required: true, match: /^[0-9]{2}[A-Z]$/ },
                            'coach': { type: String, required: true, match: /^[0-9]$/ }
                        }
                }}
            }
        }
    });
    
    let tr = new TrenitaliaSession();
    
    tr.initialize().then(ret => {
        if (ret) {
            tr.getSeatAvailability(query.query.train, query.query.seats).then(seatmap => {
                res.json(seatmap);
            }).catch(err => {
                res.json({
                    status: "ko",
                    reason: "seatmap retrieval failed",
                    err: err
                });
            })
        } else {
            res.json({
                status: "ko",
                reason: "initialization failed",
                err: 500
            });
        }
    }).catch(err => {
        functions.logger.error("error during api init: " + err);
        res.json({
            status: "ko",
            reason: "initialization failed",
            err: err.status
        });
    });
});