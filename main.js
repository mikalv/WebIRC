"use strict";

require('./data.js').install();
require('./utils.js').installGlobals();

let assert = require('assert');
let connect = require('connect');
let cookie = require('cookie');
let cookieParser = require('cookie-parser');
let crypto = require('crypto');
let express = require('express');
let expressSession = require('express-session');
let fs = require('fs-extra');
let http = require('http');
let https = require('https');
let logger = require('./logger.js');
let async = require('./async.js')
let irc = require('./irc.js');
let users = require('./users.js');
let utils = require('./utils.js');
let wss = require('ws');

let sessionKey = 'sid';
// Randomize the session secret at startup
let sessionSecret = crypto.randomBytes(32).toString('base64');

async()
	.add('config', function(cb) {
		utils.readJsonFile('config.json', cb);
	})
	.add('initLogger', ['config'], function(config) {
		logger.init(config.logLevels.console, config.logLevels.file);
	})
	.add(['config', '@initLogger'], function(config, cb) {
		async()
			.add('usersInitialized', function(cb) {
				users.initialize(cb);
			})
			.add('sessionStore', function() {
				return new expressSession.MemoryStore();
			})
			.add('expressApp', ['sessionStore'], function(sessionStore) {
				let app = express();

				app.use(cookieParser());
				app.use(expressSession({
					store: sessionStore,
					secret: sessionSecret,
					maxAge: 24 * 60 * 60,
					key: sessionKey,
					resave: false,
					saveUninitialized: true
				}));
				app.use(express.static(__dirname + '/static'));

				return app;
			})
			.add('startWebListeners', ['expressApp', 'sessionStore', '@usersInitialized'], function(expressApp, sessionStore, cb) {
				let a = async();

				if (config.http && config.http.port) {
					a.add(function(cb) {
						createWebServer(config.http, expressApp, config, sessionStore, cb);
					});
				}

				if (config.https && config.https.port) {
					a.add(function(cb) {
						createWebServer(config.https, expressApp, config, sessionStore, cb);
					});
				}

				a.run(cb);
			})
			.add(['@usersInitialized', '@startWebListeners'], function() {
				function getShutdownSignalHandler(sig) {
					return function() {
						logger.info('Received ' + sig + ' -- saving users and exiting');

						users.saveAndShutdown();
					};
				}
				process.once('SIGINT', getShutdownSignalHandler('SIGINT'));
				process.once('SIGTERM', getShutdownSignalHandler('SIGTERM'));
			})
			.run(check(
				function(err) {
					logger.error('Failed to start WebIRC:', err.toString());
					process.exit(1);
				},
				function() {
					logger.info('WebIRC started');

					cb();
				}
			));
	})
	.run(check(
		function(err) {
			console.error('Failed to start WebIRC', err);
			process.exit(1);
		},
		function() {}
	));

function createWebServer(spec, expressApp, config, sessionStore, cb) {
	let server;
	let serverProtocol;
	if (spec.keyFile && spec.certFile) {
		server = https.createServer({
			key: fs.readFileSync(spec.keyFile),
			cert: fs.readFileSync(spec.certFile),
			rejectUnauthorized: false
		}, expressApp);
		serverProtocol = 'https';
	} else {
		server = http.createServer(expressApp);
		serverProtocol = 'http';
	}

	server.listen(spec.port, function() {
		logger.info('WebIRC is listening for', serverProtocol, 'connections on port', spec.port);

		let wsServer = new wss.Server({
			server: server
		});

		wsServer.on('connection', function(socket) {
			let headers = socket.upgradeReq.headers;
			if (typeof headers == 'object' && 'cookie' in headers) {
				let parsedCookies = cookieParser.signedCookies(cookie.parse(headers.cookie), sessionSecret);

				if (sessionKey in parsedCookies) {
					sessionStore.get(parsedCookies[sessionKey], function(err, session) {
						if (!err && session) {
							processNewConnectionWithSessionId(socket, parsedCookies[sessionKey]);
						} else {
							console.warn('Session lookup failed -- invalid session ID received from client during WebSocket upgrade request');
							socket.send('refresh');
							socket.close();
						}
					});
				} else {
					console.warn('No sid in cookie');
					socket.close();
				}
			} else {
				console.warn('No cookie header or no headers');
				socket.send('refresh');
				socket.close();
			}
		});

		cb();
	});

	server.on('error', function(err) {
		cb(err);
	});
}

function processNewConnectionWithSessionId(socket, sessionId) {
	logger.info('WebSocket connection established: %s', sessionId);

	// TODO: Abstract this
	socket.sendMessage = function(msgId, data) {
		socket.send(JSON.stringify({
			msgId: msgId,
			data: data
		}));
	}

	let user = users.getUserBySessionId(sessionId);

	socket.on('message', function(rawMessage, flags) {
		let message;
		try {
			message = JSON.parse(rawMessage);
		} catch (e) {
			logger.warn('Failed to parse raw message from client: ' + rawMessage);
			return;
		}
		let msgId = message.msgId;
		let data = message.data;
		if (typeof data !== 'object') {
			logger.warn('Got a message with an invalid data field: ' + data);
			return;
		}
		// TODO: Clean up/standardize all of the parameter validations below
		if (user === null) {
			if (msgId === 'Login') {
				user = users.getUserByCredentials(data.username, data.password);

				if (user !== null) {
					// add sessionId to loggedInSessions for user
					user.loggedInSessions.push(sessionId);

					handleSuccessfulLogin(user, socket, sessionId);
				} else {
					socket.sendMessage('LoginFailed', {});
				}
			} else {
				logger.warn('Unrecognized message type from an unidentified client: ' + msgId);
			}
		} else {
			switch (msgId) {
				case 'ChatboxSend': {
					logger.info('Chatbox send', data);
					if (typeof data.entityId === 'number' && typeof data.exec == 'boolean') {
						data.lines.forEach(function(line) {
							irc.processChatboxLine(user, data.entityId, line, data.exec, sessionId);
						});
					} else {
						logger.warn('Missing entityId/exec in ChatboxSend from client');
					}
					break;
				}
				case 'AddServer': {
					let newServer = new Server({}, user.getNextEntityId.bind(user));
					user.addServer(newServer);
					newServer.showInfo('To connect: /server [host] [port] [password]');
					user.setActiveEntity(newServer.entityId);
					break;
				}
				case 'CloseWindow': {
					if ('targetEntityId' in data) {
						let targetEntity = user.getEntityById(data.targetEntityId);

						if (targetEntity !== null) {
							targetEntity.removeEntity();
						} else {
							logger.warn('Invalid targetEntityId in CloseWindow from client', data);
						}
					}
					break;
				}
				case 'JoinChannelOnServer': {
					if ('serverEntityId' in data && typeof data.serverEntityId === 'number' &&
						'channelName' in data && typeof data.channelName === 'string') {
						let server = user.getEntityById(data.serverEntityId);

						if (server !== null) {
							server.withChannel(data.channelName, check(
								function (err) {
									server.ifRegistered(function() {
										server.send('JOIN ' + data.channelName);
									});
								},
								function (channel) {
									user.setActiveEntity(channel.entityId);
								}
							));
						} else {
							logger.warn('Invalid serverEntityId in JoinChannelOnServer from client', data);
						}
					}
					break;
				}
				case 'OpenServerOptions': {
					if ('serverEntityId' in data && typeof data.serverEntityId === 'number') {
						let server = user.getEntityById(data.serverEntityId);

						if (server !== null) {
							server.showInfo('Server options aren\'t quite ready yet :)');
						} else {
							logger.warn('Invalid serverEntityId in OpenServerOptions from client', data);
						}
					}
					break;
				}
				case 'SetActiveEntity': {
					if ('targetEntityId' in data) {
						let targetEntity = user.getEntityById(data.targetEntityId);

						if (targetEntity !== null) {
							user.setActiveEntity(targetEntity.entityId);
						} else {
							logger.warn('Invalid targetEntityId in SetActiveEntity from client', data);
						}
					}
					break;
				}
			}
		}
	});

	socket.on('close', function() {
		// TODO LOW: support connection timeouts
		logger.info('WebSocket disconnected');

		// remove the socket from activeWebSockets of the user
		// nothing to remove if the socket was not yet logged in
		if (user !== null) {
			user.removeActiveWebSocket(socket);
		}
	});

	// see if this socket belongs to a user who is already logged in
	if (user !== null) {
		handleSuccessfulLogin(user, socket, sessionId);
	} else {
		socket.sendMessage('NeedLogin', {});
	}
}

function handleSuccessfulLogin(user, socket, sessionId) {
	// TODO: combine activeWebSockets with loggedInSessions
	user.activeWebSockets.push(socket);

	let userCopy = users.copyStateForClient(user);

	socket.sendMessage('CurrentState', userCopy);
}
