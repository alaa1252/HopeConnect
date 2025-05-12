const express = require("express");
const body = require("express-validator/check");

const router = express.Router();

router.put('/signup', [
    body("email").isEmail().withMessage('please enter a valid email.')
    .custom((val, {req}) => {
        return UserActivation.findOne({email: val}).then(userDoc => {
            if(userDoc) {
                return Promise.reject('email address already exists.');
            }
        });
    }).normalizeEmail(),
    body('password').trim().isLength({min:6}),
    body('name').trim.not().isEmpty()
], aurhController.signup);

router.put('/login', [
    body("email").isEmail().withMessage('please enter your email.')
    .custom((val, {req}) => {
        return UserActivation.findOne({email: val}).then(userDoc => {
            if(!userDoc) {
                return Promise.reject('email address does not exists.');
            }
        });
    }).normalizeEmail(),
    body('password').trim().isLength({min:6, max:6}),
], aurhController.signup);

module.exports = router;