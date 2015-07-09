"use strict";

var fs = require('fs');
var statechanges = require('./static/js/statechanges.js');

function installGlobals() {
	var globalFunctions = {
		check: function(errorHandler, okHandler) {
			return function(err, val) {
				if (!err) {
					okHandler.call(global, val);
				} else {
					errorHandler.call(global, err);
				}
			}
		},
		silentFail: function(okHandler) {
			return function(err, val) {
				if (!err) {
					okHandler.call(global, val);
				} else {
					// not so silent right now
					console.log('silentFail caught error:', err);
				}
			}
		}
	};

	Object.keys(globalFunctions).forEach(function(functionName) {
		global[functionName] = globalFunctions[functionName];
	});
}

function parseCtcpMessage(str) {
	var match;
	if (match = str.match(/^\u0001([^\s]+)(?: (.+))?\u0001$/)) {
		return {command: match[1].toUpperCase(), args: (typeof match[2] === 'undefined' ? null : match[2])};
	} else {
		return null;
	}
}

function toCtcp(command, args) {
	var ret = String.fromCharCode(1);

	ret += command.toUpperCase();

	if (typeof args !== 'undefined') {
		ret += ' ' + args;
	}

	ret += String.fromCharCode(1);

	return ret;
}

// note: we only validate the nick!user@host format and not what characters can or cannot be in each
// on failure to match, we assume str is a server origin
function parseOrigin(str) {
	var match;
	if (match = str.match(/^([^!]+?)!([^@]+?)@(.+?)$/)) {
		return new ClientOrigin(match[1], match[2], match[3]);
	} else {
		return new ServerOrigin(str);
	}
}

// Possible channel types: & # + ! . ~
function parseTarget(str) {
	var match;
	if (str.match(/^[#&+.~][^\s]{1,99}|![A-Z0-5]{5}[^\s]{1,94}$/)) {
		return new ChannelTarget(str);
	} else if (match = str.match(/^([a-z_\-\[\]\\^{}|`][a-z0-9_\-\[\]\\^{}|`]*)(?:@([^@]+))?$/i)) {
		return new ClientTarget(match[1], match[2]);
	} else {
		return null;
	}
}

function withParsedTarget(targetName, cb) {
	var maybeTarget = parseTarget(targetName);

	if (maybeTarget instanceof ChannelTarget ||
		maybeTarget instanceof ClientTarget) {
		cb(null, maybeTarget);
	} else {
		cb(new Error('Failed to parse as a channel or client target: ' + targetName));
	}
}

function parseKeyEqValue(str) {
	var eqPos = str.indexOf('=');

	if (eqPos >= 0) {
		return {
			key: str.substring(0, eqPos),
			val: str.substring(eqPos + 1)
		}
	} else {
		return {
			key: str,
			val: null
		}
	}
}

function readJsonFile(filePath, cb) {
	fs.readFile(filePath, check(cb, function(data) {
		var err = null;
		var config = null;

		try {
			config = JSON.parse(data);
		} catch(e) {
			err = e;
		}

		cb(err, config);
	}));
}

function ensureRequiredFields(obj, fields) {
	fields.forEach(function(field) {
		if (!(field in obj)) {
			throw new Error('Missing required field: ' + field)
		}
	});
}

exports.installGlobals = installGlobals;
exports.parseCtcpMessage = parseCtcpMessage;
exports.toCtcp = toCtcp;
exports.parseOrigin = parseOrigin;
exports.parseTarget = parseTarget;
exports.withParsedTarget = withParsedTarget;
exports.parseKeyEqValue = parseKeyEqValue;
exports.readJsonFile = readJsonFile;
exports.ensureRequiredFields = ensureRequiredFields;

// from statechanges
exports.equalsIgnoreCase = statechanges.utils.equalsIgnoreCase;
exports.setNotInChannel = statechanges.utils.setNotInChannel;
