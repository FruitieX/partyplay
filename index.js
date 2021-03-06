'use strict';

var _ = require('underscore');
var npm = require('npm');
var async = require('async');
var labeledLogger = require('./lib/logger');
var Player = require('./lib/player');
var nodeplayerConfig = require('./lib/config');
var config = nodeplayerConfig.getConfig();

var logger = labeledLogger('core');

function Core() {
    this.player = new Player();
}

Core.prototype.checkModule = function(module) {
    try {
        require.resolve(module);
        return true;
    } catch (e) {
        return false;
    }
};

Core.prototype.installModule = function(moduleName, callback) {
    logger.info('installing module: ' + moduleName);
    npm.load({}, function(err) {
        npm.commands.install(__dirname, [moduleName], function(err) {
            if (err) {
                logger.error(moduleName + ' installation failed:', err);
                callback();
            } else {
                logger.info(moduleName + ' successfully installed');
                callback();
            }
        });
    });
};

// make sure all modules are installed, installs missing ones, then calls loadCallback
Core.prototype.installModules = function(modules, moduleType, update, loadCallback) {
    async.eachSeries(modules, _.bind(function(moduleShortName, callback) {
        var moduleName = 'nodeplayer-' + moduleType + '-' + moduleShortName;
        if (!this.checkModule(moduleName) || update) {
            // perform install / update
            this.installModule(moduleName, callback);
        } else {
            // skip already installed
            callback();
        }
    }, this), loadCallback);
};

Core.prototype.initModule = function(moduleShortName, moduleType, callback) {
    var moduleTypeCapital = moduleType.charAt(0).toUpperCase() + moduleType.slice(1);
    var moduleName = 'nodeplayer-' + moduleType + '-' + moduleShortName;
    var module = require(moduleName);

    var moduleLogger = labeledLogger(moduleShortName);
    module.init(this.player, moduleLogger, _.bind(function(err) {
        if (!err) {
            this[moduleType + 's'][moduleShortName] = module;
            if (moduleType === 'backend') {
                this.songsPreparing[moduleShortName] = {};
            }

            moduleLogger.info(moduleType + ' module initialized');
            this.callHooks('on' + moduleTypeCapital + 'Initialized', [moduleShortName]);
        } else {
            moduleLogger.error('while initializing: ' + err);
            this.callHooks('on' + moduleTypeCapital + 'InitError', [moduleShortName]);
        }
        callback(err);
    }, this.player));
};

Core.prototype.initModules = function(update, callback) {
    async.eachSeries(['plugin', 'backend'], _.bind(function(moduleType, installCallback) {
        // first install missing modules
        this.installModules(config[moduleType + 's'], moduleType, update, installCallback);
    }, this), _.bind(function() {
        // then initialize modules, first all plugins in series, then all backends in parallel
        async.eachSeries(['plugin', 'backend'], _.bind(function(moduleType, typeCallback) {
            var moduleTypeCapital = moduleType.charAt(0).toUpperCase() + moduleType.slice(1);

            (moduleType === 'plugin' ? async.eachSeries : async.each)
                (config[moduleType + 's'], _.bind(function(moduleName, moduleCallback) {
                if (this.checkModule('nodeplayer-' + moduleType + '-' + moduleName)) {
                    this.initModule(moduleName, moduleType, moduleCallback);
                }
            }, this), _.bind(function(err) {
                logger.info('all ' + moduleType + ' modules initialized');
                this.callHooks('on' + moduleTypeCapital + 'sInitialized');
                typeCallback();
            }, this.player));
        }, this), function() {
            callback();
        });
    }, this));
};

exports.Player = Player;
exports.labeledLogger = labeledLogger;
exports.config = nodeplayerConfig;

exports.Core = Core;
