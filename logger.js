"use strict";

const fs = require('fs');
const winston = require('winston');

const loggerConfig = {
	levels: {
		data: 0,
		debug: 1,
		info: 2,
		warn: 3,
		error: 4
	},
	colors: {
		data: 'grey',
		debug: 'magenta',
		info: 'green',
		warn: 'yellow',
		error: 'red'
	}
};

let logger = null;

function init(logLevelConsole, logLevelFile) {
	logLevelConsole = validateLogLevel(logLevelConsole, 'debug');
	logLevelFile = validateLogLevel(logLevelFile, 'data');
	const logDir = 'logs';
	// sync is okay as this is on startup
	if (!fs.existsSync(logDir)) {
		fs.mkdirSync(logDir);
	}
	const unixTime = Math.floor((new Date()).getTime() / 1000);
	const logPrefix = logDir + '/' + unixTime + '-';
	logger = new winston.Logger({
		transports: [
			new winston.transports.Console({
				colorize: true,
				level: logLevelConsole
			}),
			new winston.transports.File({
				filename: logPrefix + 'main.log',
				level: logLevelFile,
				json: false
			})
		],
		levels: loggerConfig.levels,
		colors: loggerConfig.colors
	});
	logger.debug('Logger initialized with logLevelConsole %s and logLevelFile %s', logLevelConsole, logLevelFile);
}

function validateLogLevel(logLevel, defaultLogLevel) {
	if (typeof logLevel === 'string' && logLevel in loggerConfig.levels) {
		// valid
		return logLevel;
	} else {
		// invalid or not present
		return defaultLogLevel;
	}
}

function data() {
	if (logger) {
		logger.data.apply(this, arguments);
	}
}

function debug() {
	if (logger) {
		logger.debug.apply(this, arguments);
	}
}

function info() {
	if (logger) {
		logger.info.apply(this, arguments);
	}
}

function warn() {
	if (logger) {
		logger.warn.apply(this, arguments);
	}
}

function error() {
	if (logger) {
		logger.error.apply(this, arguments);
	}
}

module.exports.init = init;
module.exports.data = data;
module.exports.debug = debug;
module.exports.info = info;
module.exports.warn = warn;
module.exports.error = error;
