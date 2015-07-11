"use strict";

const assert = require('assert');
const clientcommands = require('./clientcommands.js');
const errno = require('errno');
const logger = require('./logger.js');
const mode = require('./mode.js');
const moment = require('moment');
const net = require('net');
const tls = require('tls');
const users = require('./users.js');
const utils = require('./utils.js');

const serverCommandHandlers = {
	'001': handleCommandRequireArgs(1, handle001),
	'002': handleCommandRequireArgs(2, showInfoLast),
	'003': handleCommandRequireArgs(2, showInfoLast),
	'004': handleCommandRequireArgs(5, handle004),
	'005': handleCommandRequireArgs(2, handle005),
	'250': handleCommandRequireArgs(2, showInfoLast),
	'251': handleCommandRequireArgs(2, showInfoLast),
	'252': handleCommandRequireArgs(3, showInfoLast2),
	'253': handleCommandRequireArgs(3, showInfoLast2),
	'254': handleCommandRequireArgs(3, showInfoLast2),
	'255': handleCommandRequireArgs(2, showInfoLast),
	'265': handleCommandRequireArgs(2, showInfoLast),
	'266': handleCommandRequireArgs(2, showInfoLast),
	'311': handleCommandRequireArgs(6, handle311), // RPL_WHOISUSER
	'312': handleCommandRequireArgs(4, handle312), // RPL_WHOISSERVER
	'317': handleCommandRequireArgs(4, handle317), // RPL_WHOISIDLE
	'318': emptyHandler, // RPL_ENDOFWHOIS
	'319': handleCommandRequireArgs(3, handle319), // RPL_WHOISCHANNELS
	'328': handleCommandRequireArgs(3, handle328), // RPL_CHANNEL_URL
	'330': handleCommandRequireArgs(4, handle330), // RPL_WHOISACCOUNT
	'331': handleCommandRequireArgs(3, handle331), // RPL_NOTOPIC
	'332': handleCommandRequireArgs(3, handle332), // RPL_TOPIC
	'333': handleCommandRequireArgs(4, handle333), // RPL_TOPICWHOTIME
	'353': handleCommandRequireArgs(4, handle353), // RPL_NAMREPLY
	'366': handleCommandRequireArgs(2, handle366), // RPL_ENDOFNAMES
	'372': handleCommandRequireArgs(2, showInfoLast), // RPL_MOTD
	'375': handleCommandRequireArgs(2, showInfoLast), // RPL_MOTDSTART
	'376': handleCommandRequireArgs(2, showInfoLast), // RPL_ENDOFMOTD
	'378': handleCommandRequireArgs(3, handle378), // RPL_MOTD
	'401': handleCommandRequireArgs(2, handle401), // ERR_NOSUCHNICK
	'421': handleCommandRequireArgs(2, handle421), // ERR_UNKNOWNCOMMAND
	'422': handleCommandRequireArgs(2, showInfoLast),
	'432': handleCommandRequireArgs(2, handle432), // ERR_ERRONEUSNICKNAME
	'433': handleCommandRequireArgs(2, handle433), // ERR_NICKNAMEINUSE
	'671': handleCommandRequireArgs(3, handle671), // RPL_WHOISSECURE
	'ERROR': handleCommandRequireArgs(1, handleError),
	'JOIN': handleCommandRequireArgs(1, handleJoin),
	'KICK': handleCommandRequireArgs(2, handleKick),
	'MODE': handleCommandRequireArgs(2, handleMode),
	'NICK': handleCommandRequireArgs(1, handleNick),
	'NOTICE': handleCommandRequireArgs(2, handleNotice),
	'PART': handleCommandRequireArgs(1, handlePart),
	'PING': handleCommandRequireArgs(1, handlePing),
	'PONG': handleCommandRequireArgs(2, handlePong),
	'PRIVMSG': handleCommandRequireArgs(2, handlePrivmsg),
	'QUIT': handleCommandRequireArgs(1, handleQuit),
	'TOPIC': handleCommandRequireArgs(2, handleTopic),
};

// commands allowed to be processed before registration (001)
const preregAllowedCommands = [
	'001',
	'432', // ERR_ERRONEUSNICKNAME
	'433', // ERR_NICKNAMEINUSE
	'PING',
	'NOTICE'
];

function handleCommandRequireArgs(requiredNumArgs, handler) {
	// note: allArgs includes user, server, and origin -- these are not counted in numArgs as numArgs represends the number of args after the command
	return function(numArgs, allArgs) {
		if (numArgs >= requiredNumArgs) {
			return handler.apply(null, allArgs);
		} else {
			// invalid number of arguments
			logger.error('Error: Invalid number of arguments in command handler: %s (got %d)', handler.toString(), numArgs);
			return false;
		}
	};
}

function showInfoLast(user, server, origin) {
	if (arguments.length >= 5) {
		const text = arguments[arguments.length - 1];
		server.showInfo(text);
	} else {
		logger.error('showInfoLast called with arguments.length = ' + arguments.length);
	}
}

function showInfoLast2(user, server, origin) {
	if (arguments.length >= 6) {
		server.showInfo(Array.prototype.slice.call(arguments, -2).join(' '));
	} else {
		logger.error('showInfoLast2 called with arguments.length = ' + arguments.length);
	}
}

function emptyHandler() {
}

function handle001(user, server, origin, myNickname, text) {
	user.applyStateChange('EditServer', server.entityId, {
		currentNickname: myNickname
	});

	server.channels.forEach(function(channel) {
		channel.rejoin();
	});

	server.startPings();

	server.showInfo(text);
}

function handle004(user, server, origin, myNickname, serverName, serverVersion, userModes, channelModes) {
	server.showInfo('Server ' + serverName + ' running ' + serverVersion);
	server.showInfo('Supported user modes: ' + userModes);
	server.showInfo('Supported channel modes: ' + channelModes);
}

function handle005(user, server, origin) {
	const keyValueStrings = Array.prototype.slice.call(arguments, 4, arguments.length - 1);
	keyValueStrings.forEach(function(keyValueStr) {
		const kv = utils.parseKeyEqValue(keyValueStr);
		if (kv.key === 'NETWORK') {
			if (kv.val) {
				user.applyStateChange('EditServer', server.entityId, {
					label: kv.val
				});
			}
		}
	});
	server.showInfo('Server settings: ' + keyValueStrings.join(' '));
}

function handle311(user, server, origin, myNickname, nick, username, host, star, realName) {
	server.showWhois(nick + ' is ' + username + '@' + host + ' (' + realName + ')');
}

function handle312(user, server, origin, myNickname, nick, serverName, serverDesc) {
	server.showWhois(nick + ' is connected to ' + serverName + ' (' + serverDesc + ')');
}

function handle317(user, server, origin, myNickname, nick, secondsIdle, signonTime) {
	const signonDate = new Date(signonTime * 1000);
	server.showWhois(nick + ' has been idle for ' + moment().add('seconds', secondsIdle).fromNow(true) + ' (signed on ' + moment(signonDate).fromNow() + ')');
}

function handle319(user, server, origin, myNickname, nick, channels) {
	server.showWhois(nick + ' is on ' + channels);
}

function handle328(user, server, origin, myNickname, channelName, channelUrl) {
	server.withChannel(channelName, silentFail(function(channel) {
		user.applyStateChange('Info', channel.entityId, 'URL: ' + channelUrl);
	}));
}

function handle330(user, server, origin, myNickname, nick, authName, text) {
	server.showWhois(nick + ' ' + text + ' ' + authName);
}

function handle331(user, server, origin, myNickname, channelName, text) {
	server.showInfo(text, true);
}

function handle332(user, server, origin, myNickname, channelName, topicText) {
	server.withChannel(channelName, silentFail(function(channel) {
		user.applyStateChange('Info', channel.entityId, 'Topic is: ' + topicText);
	}));
}

function handle333(user, server, origin, myNickname, channelName, setByNick, topicTime) {
	server.withChannel(channelName, silentFail(function(channel) {
		const topicDate = new Date(topicTime * 1000);
		user.applyStateChange('Info', channel.entityId, 'Set by ' + setByNick + ' (' + moment(topicDate).fromNow() + ')');
	}));
}

function handle353(user, server, origin, myNickname, channelType, channelName, namesList) {
	server.withChannel(channelName, silentFail(function(channel) {
		// build a list of UserlistEntry
		const userlistEntries = [];
		namesList.trim().split(' ').forEach(function(nickWithFlags) {
			const userlistEntryMaybe = parseUserlistEntry(nickWithFlags);
			if (userlistEntryMaybe !== null) {
				userlistEntries.push(userlistEntryMaybe);
			}
		});
		user.applyStateChange('NamesUpdateAdd', channel.entityId, userlistEntries);
	}));
}

function handle378(user, server, origin, myNickname, nick, text) {
	server.showWhois(nick + ' ' + text);
}

// ~owner, &admin, @op, %halfop, +voice, regular
// combinations possible, e.g. &@name
function parseUserlistEntry(nickWithFlags) {
	const userlistEntry = new UserlistEntry();
	for (let i of indices(nickWithFlags.length)) {
		switch (nickWithFlags.charAt(i)) {
			case '~':
				userlistEntry.owner = true;
				break;
			case '&':
				userlistEntry.admin = true;
				break;
			case '@':
				userlistEntry.op = true;
				break;
			case '%':
				userlistEntry.halfop = true;
				break;
			case '+':
				userlistEntry.voice = true;
				break;
			default:
				userlistEntry.nick = nickWithFlags.substring(i);
				return userlistEntry;
		}
	}

	// if here, we got an empty name
	return null;
}

function handle366(user, server, origin, myNickname, channelName) {
	server.withChannel(channelName, silentFail(function(channel) {
		user.applyStateChange('NamesUpdate', channel.entityId);
	}));
}

function handle401(user, server, origin, myNickname, targetName) {
	user.showError('No such nick/channel: ' + targetName);
}

function handle421(user, server, origin, myNickname, commandName, text) {
	user.showError('Unknown command: ' + commandName);
}

function handle432(user, server, origin, myNickname, targetName) {
	server.showError('Invalid nickname: ' + targetName, false);
	if (!server.isRegistered()) {
		tryAnotherNickname(server, targetName);
	}
}

function handle433(user, server, origin, myNickname, targetName) {
	server.showError('Nickname already in use: ' + targetName, false);
	if (!server.isRegistered()) {
		tryAnotherNickname(server, targetName);
	}
}

function tryAnotherNickname(server, lastNickname) {
	const nextNickname = server.getActiveIdentity().nextNickname(lastNickname);
	if (nextNickname !== null) {
		server.send('NICK :' + nextNickname);
	} else {
		server.disconnect();
	}
}

function handle671(user, server, origin, myNickname, nick, text) {
	server.showWhois(nick + ' ' + text);
}

function handlePing(user, server, origin, arg) {
	server.send('PONG :' + arg);
}

function handlePong(user, server, origin, arg) {
	// ignore for now
}

function handleError(user, server, origin, text) {
	server.showError(text, false);
}

function handleJoin(user, server, origin, channelName) {
	if (origin !== null && origin instanceof ClientOrigin) {
		// if the nickname of the joiner matches ours
		if (utils.equalsIgnoreCase(server.currentNickname, origin.nick)) {
			// the server is confirming that we've joined the channel
			server.joinedChannel(channelName);
		} else {
			// someone joined one of the channels we should be in
			server.withChannel(channelName, silentFail(function(channel) {
				const newUserlistEntry = new UserlistEntry();
				newUserlistEntry.nick = origin.nick;
				newUserlistEntry.user = origin.user;
				newUserlistEntry.host = origin.host;
				user.applyStateChange('Join', channel.entityId, newUserlistEntry);
			}));
		}
	}
}

function handleKick(user, server, origin, channelName, targetName, kickMessage) {
	if (origin !== null) {
		utils.withParsedTarget(targetName, silentFail(function(target) {
			if (target instanceof ClientTarget) {
				server.withChannel(channelName, silentFail(function(channel) {
					user.applyStateChange('Kick', channel.entityId, origin, target.nick, kickMessage);
				}));
			}
		}));
	}
}

function handleMode(user, server, origin, targetName, modes) {
	const handleModeArguments = arguments;
	utils.withParsedTarget(targetName, silentFail(function(target) {
		if (target instanceof ClientTarget) {
			// it's a user mode
			if (utils.equalsIgnoreCase(server.currentNickname, target.nick)) {
				logger.debug('User mode change', modes);
			}
		} else if (target instanceof ChannelTarget) {
			// it's a channel mode
			server.withChannel(target.name, silentFail(function(channel) {
				const modeArgs = Array.prototype.slice.call(handleModeArguments, 5);
				const parsedModes = mode.parseChannelModes(modes, modeArgs);
				user.applyStateChange('ModeChange', channel.entityId, origin, modes, modeArgs);
				if (parsedModes !== null) {
					parsedModes.forEach(function(parsedMode) {
						// a, h, o, q, v
						const userlistEntryAttribute = mode.getUserlistEntryAttributeByMode(parsedMode.mode);
						if (userlistEntryAttribute !== null) {
							user.applyStateChange('UserlistModeUpdate', channel.entityId, parsedMode.arg, parsedMode.plus, userlistEntryAttribute);
						}
						// for now, we ignore all other modes
					});
				} else {
					logger.error('Unable to parse channel mode change!');
				}
			}));
		}
	}));
}

function handleNick(user, server, origin, newNickname) {
	if (origin !== null && origin instanceof ClientOrigin) {
		user.applyStateChange('NickChange', server.entityId, origin.nick, newNickname);
	}
}

function handleNotice(user, server, origin, targetName, text) {
	if (origin !== null) {
		if (server.isRegistered()) {
			utils.withParsedTarget(targetName, silentFail(function(target) {
				// here we have a valid target
				const ctcpMessage = utils.parseCtcpMessage(text);
				if (ctcpMessage !== null) {
					logger.warn('CTCP reply handling not implemented');
				} else {
					// not CTCP reply, but a regular notice
					if (target instanceof ChannelTarget) {
						server.withChannel(target.name, silentFail(function(channel) {
							user.applyStateChange('ChannelNotice', channel.entityId, origin, channel.name, text);
						}));
					} else if (target instanceof ClientTarget) {
						if (utils.equalsIgnoreCase(server.currentNickname, target.nick)) {
							// we are the recipient
							user.applyStateChange('Notice', server.getActiveOrServerEntity(), origin, text);
						}
					}
				}
			}));
		} else {
			// a notice before the 001, so we ignore the target and assume it's for us
			user.applyStateChange('Notice', server.entityId, origin, text);
		}
	}
}

function handlePart(user, server, origin, channelName) {
	if (origin !== null && origin instanceof ClientOrigin) {
		// if the nickname of the leaver matches ours
		if (utils.equalsIgnoreCase(server.currentNickname, origin.nick)) {
			// the server is confirming that we've left the channel
			server.withChannel(channelName, silentFail(function(channel) {
				utils.setNotInChannel(channel);
				// if rejoining is set, keep the window open as we've already sent a JOIN for this channel
				if (!channel.rejoining) {
					channel.removeEntity();
				}
			}));
		} else {
			// someone left one of the channels we should be in
			server.withChannel(channelName, silentFail(function(channel) {
				const who = new UserlistEntry();
				who.nick = origin.nick;
				who.user = origin.user;
				who.host = origin.host;
				user.applyStateChange('Part', channel.entityId, who);
			}));
		}
	}
}

function handlePrivmsg(user, server, origin, targetName, text) {
	if (origin !== null) {
		utils.withParsedTarget(targetName, silentFail(function(target) {
			// here we have a valid target
			const ctcpMessage = utils.parseCtcpMessage(text);
			if (ctcpMessage !== null) {
				handleCtcp(server, origin, target, ctcpMessage);
			} else {
				// not CTCP, but a regular message
				if (target instanceof ChannelTarget) {
					server.withChannel(target.name, silentFail(function(channel) {
						user.applyStateChange('ChatMessage', channel.entityId, origin, text);
					}));
				} else if (target instanceof ClientTarget) {
					if (utils.equalsIgnoreCase(server.currentNickname, target.nick)) {
						// we are the recipient
						const query = server.ensureQuery(origin.getNickOrName());
						user.applyStateChange('ChatMessage', query.entityId, origin, text);
					}
				}
			}
		}));
	}
}

function handleQuit(user, server, origin, quitMessage) {
	if (origin !== null && origin instanceof ClientOrigin) {
		user.applyStateChange('Quit', server.entityId, origin, quitMessage);
	}
}

function handleTopic(user, server, origin, channelName, newTopic) {
	server.withChannel(channelName, silentFail(function(channel) {
		user.applyStateChange('SetTopic', channel.entityId, origin, newTopic);
	}));
}

function handleCtcp(server, origin, target, ctcpMessage) {
	if (origin !== null && origin instanceof ClientOrigin) {
		if (ctcpMessage.command === 'ACTION' && ctcpMessage.args !== null) {
			if (target instanceof ChannelTarget) {
				server.withChannel(target.name, silentFail(function(channel) {
					server.user.applyStateChange('ActionMessage', channel.entityId, origin, ctcpMessage.args);
				}));
			} else if (target instanceof ClientTarget) {
				if (utils.equalsIgnoreCase(server.currentNickname, target.nick)) {
					// we are the recipient
					const query = server.ensureQuery(origin.getNickOrName());
					server.user.applyStateChange('ActionMessage', query.entityId, origin, ctcpMessage.args);
				}
			}
		} else {
			logger.info('Received CTCP %s from %s', ctcpMessage.command, origin.getNickOrName());
		}
	}
}

function reconnectServer(server) {
	server.disconnect(); // noop if not connected
	server.showInfo('Connecting to ' + server.host + ':' + server.port);
	const connectOptions = {
		host: server.host,
		port: server.port
	};
	if (server.ssl) {
		connectOptions.rejectUnauthorized = false; // no certificate validation yet
	}
	const netOrTls = server.ssl ? tls : net;
	const serverSocket = netOrTls.connect(connectOptions, function() {
		logger.info('Connected to server %s:%d', server.host, server.port);
		server.user.applyStateChange('EditServer', server.entityId, {
			connected: true
		});
		if (server.password) {
			server.send('PASS ' + server.password);
		}
		const activeIdentity = server.getActiveIdentity();
		server.send('NICK ' + activeIdentity.nextNickname());
		server.send('USER ' + activeIdentity.username + ' ' + activeIdentity.username + ' ' + server.host + ' :' + activeIdentity.realName);
	});
	server.socket = serverSocket;
	serverSocket.on('error', function(err) {
		logger.warn('Connection to server closed due to error:', err);
		const errorString = err.syscall + ': ' + ((err.code in errno.code) ? errno.code[err.code].description : err.code);
		if (server.connected) {
			server.showError('Connection closed (' + errorString + ')');
		} else {
			server.showError('Unable to connect (' + errorString + ')');
		}
		server.disconnect();
	});
	let readBuffer = '';
	serverSocket.on('data', function(data) {
		readBuffer += data;
		while (true) {
			const lineEndIndex = readBuffer.indexOf('\r\n');
			if (lineEndIndex === -1) {
				break;
			}
			const line = readBuffer.substring(0, lineEndIndex);
			readBuffer = readBuffer.substring(lineEndIndex + 2);
			processLineFromServer(line, server);
		}
	});
	serverSocket.on('end', function() {
		server.disconnect();
	});
}

function processLineFromServer(line, server) {
	logger.data('Line: ' + line);
	const parseResult = parseLine(line);
	if (parseResult !== null) {
		if (parseResult.command in serverCommandHandlers) {
			// either already registered (001) or it's a command that's allowed to be received before registration
			if (server.isRegistered() || ~preregAllowedCommands.indexOf(parseResult.command)) {
				serverCommandHandlers[parseResult.command](
					parseResult.args.length,
					[
						server.user,
						server,
						(parseResult.origin !== null ? utils.parseOrigin(parseResult.origin) : null)
					].concat(parseResult.args)
				);
			} else {
				server.user.applyStateChange('Error', server.entityId, 'Server protocol violation: Received ' + parseResult.command + ' before registration.');
			}
		} else {
			server.user.applyStateChange('Text', server.entityId, parseResult.command + ' ' + parseResult.args.join(' '));
		}
	} else {
		logger.error('Invalid line from server: ' + line);
	}
}

// returns: { origin, command, args[] }
function parseLine(line) {
	let origin = null;
	let command = null;
	const args = [];
	if (line.length === 0) {
		// empty line is not valid
		return null;
	}
	let spaceAt;
	// first, parse the origin (if any)
	if (line.charAt(0) === ':') {
		spaceAt = line.indexOf(' ');
		if (spaceAt !== -1) {
			origin = line.substring(1, spaceAt);
			line = line.substring(spaceAt + 1);
		} else {
			// one word that starts with a : is not valid
			return null;
		}
	}
	if (line.length === 0) {
		// no command? invalid line
		return null;
	}
	// second, parse the command
	spaceAt = line.indexOf(' ');
	if (spaceAt !== -1) {
		command = line.substr(0, spaceAt);
		line = line.substring(spaceAt + 1);
	} else {
		command = line;
		line = null;
	}
	// now parse the args
	while (line !== null && line.length > 0) {
		if (line.charAt(0) === ':') {
			args.push(line.substring(1));
			line = null;
		} else {
			spaceAt = line.indexOf(' ');
			if (spaceAt !== -1) {
				args.push(line.substring(0, spaceAt));
				line = line.substring(spaceAt + 1);
			} else {
				args.push(line);
				line = null;
			}
		}
	}
	return {
		origin: origin,
		command: command,
		args: args
	};
}

function processChatboxLine(user, activeEntityId, line, parseCommands, sessionId) {
	if (user.currentActiveWindow !== null) {
		let command = null;
		let rest = line;
		if (parseCommands) {
			let match;
			if (match = line.match(/^\/([a-z0-9]*)\s*(.*?)$/i)) {
				command = match[1].toUpperCase();
				rest = match[2];
			}
		}
		const activeEntity = user.getEntityById(activeEntityId);
		const server = activeEntity.server;
		if (activeEntity !== null) {
			if (command !== null) {
				clientcommands.handleClientCommand(activeEntity, command, rest, sessionId);
			} else {
				if (activeEntity.type === 'channel') {
					server.ifRegistered(function() {
						const channel = activeEntity;
						user.applyStateChange('MyChatMessage', channel.entityId, rest);
						server.send('PRIVMSG ' + channel.name + ' :' + rest);
					});
				} else if (activeEntity.type === 'query') {
					server.ifRegistered(function() {
						const query = activeEntity;
						user.applyStateChange('MyChatMessage', query.entityId, rest);
						server.send('PRIVMSG ' + query.name + ' :' + rest);
					});
				} else {
					server.showError('Only commands are processed in this window', true);
				}
			}
		}
	} else {
		assert(false, 'No active window in processChatboxLine');
	}
}

exports.reconnectServer = reconnectServer;
exports.processChatboxLine = processChatboxLine;
