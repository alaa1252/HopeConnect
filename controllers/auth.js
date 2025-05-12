const {validationResult} = require("express-validator/check");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

exports.signup = () => {
    const errors = validationResult(req);
    if(!errors.isEmpty()) {
        const error = new Error("validation failed");
        error.statusCode = 422;
        error.data = req.body;
        throw errors;
    }
    const email = req.body.email;
    const name = req.body.name;
    const password = req.body.password;
    bcrypt.hash(password, 12).then((hashedPw) => {
        const user = new User({
            email: email,
            password: hashedPw,
            name: name
        });
        return user.save();
    }).then(res => {
        res.status(201).json({
            message: "user created succsisfully.",
            userId: res._id
        });
    }).catch(err => {
        if(!err.statusCode) {
            err.statusCode = 500;
        }
        next(err);
    })
}