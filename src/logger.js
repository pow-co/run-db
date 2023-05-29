"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var config_1 = require("./config");
var logger = {};
logger.info = console.info.bind(console);
logger.warn = console.warn.bind(console);
logger.error = console.error.bind(console);
logger.debug = config_1.DEBUG ? console.debug.bind(console) : function () { };
exports.default = logger;
