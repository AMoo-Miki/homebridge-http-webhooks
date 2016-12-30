var request = require("request");
var http = require('http');
var url = require('url');
var Service, Characteristic;
var DEFAULT_REQUEST_TIMEOUT = 10000;

module.exports = function(homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;

    homebridge.registerPlatform("homebridge-http-webhooks", "HttpWebHooks", HttpWebHooksPlatform);
    homebridge.registerAccessory("homebridge-http-webhooks", "HttpWebHookSensor", HttpWebHookSensorAccessory);
    homebridge.registerAccessory("homebridge-http-webhooks", "HttpWebHookSwitch", HttpWebHookSwitchAccessory);
    homebridge.registerAccessory("homebridge-http-webhooks", "HttpWebHookDoor", HttpWebHookDoorAccessory);
};

function HttpWebHooksPlatform(log, config){
    this.log = log;
    this.cacheDirectory = config["cache_directory"] || "./.node-persist/storage";
    this.webhookPort = config["webhook_port"] || 51828;
    this.sensors = config["sensors"] || [];
    this.switches = config["switches"] || [];
    this.doors = config["doors"] || [];
    this.storage = require('node-persist');
    this.storage.initSync({dir:this.cacheDirectory});
}

HttpWebHooksPlatform.prototype = {

    accessories: function(callback) {
        var accessories = [],
            i;
        for(i = 0; i < this.sensors.length; i++){
            var sensor = new HttpWebHookSensorAccessory(this.log, this.sensors[i], this.storage);
            accessories.push(sensor);
        }

        for(i = 0; i < this.switches.length; i++){
            var switchAccessory = new HttpWebHookSwitchAccessory(this.log, this.switches[i], this.storage);
            accessories.push(switchAccessory);
        }

        for(i = 0; i < this.doors.length; i++){
            var doorAccessory = new HttpWebHookDoorAccessory(this.log, this.doors[i], this.storage);
            accessories.push(doorAccessory);
        }

        var accessoriesCount = accessories.length;

        callback(accessories);

        http.createServer((function(request, response) {
            var theUrl = request.url;
            var theUrlParts = url.parse(theUrl, true);
            var theUrlParams = theUrlParts.query;
            var body = [];
            request.on('error', (function(err) {
                this.log("[ERROR Http WebHook Server] Reason: %s.", err);
            }).bind(this)).on('data', function(chunk) {
                body.push(chunk);
            }).on('end', (function() {
                body = Buffer.concat(body).toString();

                response.on('error', function(err) {
                    this.log("[ERROR Http WebHook Server] Reason: %s.", err);
                });

                response.statusCode = 200;
                response.setHeader('Content-Type', 'application/json');

                if(!theUrlParams.accessoryId) {
                    response.statusCode = 404;
                    response.setHeader("Content-Type", "text/plain");
                    var errorText = "[ERROR Http WebHook Server] No accessoryId in request.";
                    this.log(errorText);
                    response.write(errorText);
                    response.end();
                }
                else {
                    var responseBody = {
                        success: true
                    };
                    var accessoryId = theUrlParams.accessoryId;
                    for(var i = 0; i < accessoriesCount; i++){
                        var accessory = accessories[i];
                        if(accessory.id === accessoryId) {
                            if(!theUrlParams.state) {
                                var cachedState = this.storage.getItemSync("http-webhook-"+accessoryId);
                                if(cachedState === undefined) {
                                    cachedState = false;
                                }
                                responseBody = {
                                    success: true,
                                    state: cachedState
                                };
                            }
                            else {
                                var state = theUrlParams.state;
                                var stateBool = state==="true";
                                this.storage.setItemSync("http-webhook-"+accessoryId, stateBool);
                                //this.log("[INFO Http WebHook Server] State change of '%s' to '%s'.",accessory.id,stateBool);
                                accessory.changeHandler(stateBool);
                            }
                            break;
                        }
                    }
                    response.write(JSON.stringify(responseBody));
                    response.end();
                }
            }).bind(this));
        }).bind(this)).listen(this.webhookPort);
        this.log("Started server for webhooks on port '%s'.", this.webhookPort);
    }
}

function HttpWebHookSensorAccessory(log, sensorConfig, storage) {
    this.log = log;
    this.id = sensorConfig["id"];
    this.name = sensorConfig["name"];
    this.type = sensorConfig["type"];
    this.storage = storage;

    if(this.type === "contact") {
        this.service = new Service.ContactSensor(this.name);
        this.changeHandler = (function(newState){
            this.log("Change HomeKit state for contact sensor to '%s'.", newState);
             this.service.getCharacteristic(Characteristic.ContactSensorState)
                    .setValue(newState ? Characteristic.ContactSensorState.CONTACT_DETECTED : Characteristic.ContactSensorState.CONTACT_NOT_DETECTED, undefined, 'fromHTTPWebhooks');
        }).bind(this);
        this.service
            .getCharacteristic(Characteristic.ContactSensorState)
            .on('get', this.getState.bind(this));
    } else if(this.type === "motion") {
        this.service = new Service.MotionSensor(this.name);
        this.changeHandler = (function(newState){
            //this.log("Change HomeKit state for motion sensor to '%s'.", newState);
            this.service.getCharacteristic(Characteristic.MotionDetected)
                    .setValue(newState, undefined, 'fromHTTPWebhooks');
        }).bind(this);
        this.service
            .getCharacteristic(Characteristic.MotionDetected)
            .on('get', this.getState.bind(this));
    } else if(this.type === "occupancy") {
        this.service = new Service.OccupancySensor(this.name);
        this.changeHandler = (function(newState){
            //this.log("Change HomeKit state for occupancy sensor to '%s'.", newState);
            this.service.getCharacteristic(Characteristic.OccupancyDetected)
                    .setValue(newState, undefined, 'fromHTTPWebhooks');
        }).bind(this);
        this.service
            .getCharacteristic(Characteristic.OccupancyDetected)
            .on('get', this.getState.bind(this));
    } else if(this.type === "smoke") {
        this.service = new Service.SmokeSensor(this.name);
        this.changeHandler = (function(newState){
            this.log("Change HomeKit state for smoke sensor to '%s'.", newState);
            this.service.getCharacteristic(Characteristic.SmokeDetected)
                    .setValue(newState, undefined, 'fromHTTPWebhooks');
        }).bind(this);
        this.service
            .getCharacteristic(Characteristic.SmokeDetected)
            .on('get', this.getState.bind(this));
    }
}

HttpWebHookSensorAccessory.prototype.getState = function(callback) {
    this.log("Getting current state for '%s'...", this.id);
    var state = this.storage.getItemSync("http-webhook-"+this.id);
    if(state === undefined) {
        state = false;
    }
    if(this.type === "contact") {
        callback(null, state ? Characteristic.ContactSensorState.CONTACT_DETECTED : Characteristic.ContactSensorState.CONTACT_NOT_DETECTED);
    }
    else if(this.type === "smoke") {
        callback(null, state ? Characteristic.SmokeDetected.SMOKE_DETECTED : Characteristic.SmokeDetected.SMOKE_NOT_DETECTED);
    }
    else {
        callback(null, state);
    }
};

HttpWebHookSensorAccessory.prototype.getServices = function() {
  return [this.service];
};

function HttpWebHookSwitchAccessory(log, switchConfig, storage) {
    this.log = log;
    this.id = switchConfig["id"];
    this.name = switchConfig["name"];
    this.onURL = switchConfig["on_url"] || "";
    this.offURL = switchConfig["off_url"] || "";
    this.storage = storage;

    this.service = new Service.Switch(this.name);
    this.changeHandler = (function(newState) {
        this.log("Change HomeKit state for switch to '%s'.", newState);
        this.service.getCharacteristic(Characteristic.On)
                .setValue(newState, undefined, 'fromHTTPWebhooks');
    }).bind(this);
    this.service
        .getCharacteristic(Characteristic.On)
        .on('get', this.getState.bind(this))
        .on('set', this.setState.bind(this));
}

HttpWebHookSwitchAccessory.prototype.getState = function(callback) {
    this.log("Getting current state for '%s'...", this.id);
    var state = this.storage.getItemSync("http-webhook-"+this.id);
    if(state === undefined) {
        state = false;
    }
    callback(null, state);
};

HttpWebHookSwitchAccessory.prototype.setState = function(powerOn, callback) {
    this.log("Switch state for '%s'...", this.id);
    this.storage.setItemSync("http-webhook-"+this.id, powerOn);
    var urlToCall = this.onURL;
    if(!powerOn) {
        urlToCall = this.offURL;
    }
    if(urlToCall !== "") {
        request.get({
            url: urlToCall,
            timeout: DEFAULT_REQUEST_TIMEOUT
        }, (function(err, response, body) {
            var statusCode = response && response.statusCode ? response.statusCode: -1;
            this.log("Request to '%s' finished with status code '%s' and body '%s'.", url, statusCode, body, err);
            if (!err && statusCode == 200) {
                callback(null);
            }
            else {
                callback(err || new Error("Request to '"+url+"' was not succesful."));
            }
        }).bind(this));
    }
};

HttpWebHookSwitchAccessory.prototype.getServices = function() {
  return [this.service];
};

function HttpWebHookDoorAccessory(log, doorConfig, storage) {
    this.log = log;
    this.id = doorConfig["id"];
    this.name = doorConfig["name"];
    this.openURL = doorConfig["open_url"] || "";
    this.closeURL = doorConfig["close_url"] || "";
    this.stateURL = doorConfig["state_url"] || "";
    this.type = doorConfig["type"];
    this.reverse = doorConfig["reverse"] ? 1 : 0;
    this.duration = parseInt(doorConfig["duration"]);
    this.storage = storage;

    if (!this.duration || !isFinite(this.duration)) this.duration = 15000;

    if (this.type === "garage") {
        this.service = new Service.GarageDoorOpener(this.name);
        this.writeState = function(newState) {
            var intState = newState ? 1 : 0,
                isClosed = intState !== this.reverse;

            this.service.getCharacteristic(Characteristic.CurrentDoorState)
                .setValue(isClosed ? Characteristic.CurrentDoorState.CLOSED : Characteristic.CurrentDoorState.OPEN, undefined, 'fromHTTPWebhooks');

            this.service.getCharacteristic(Characteristic.TargetDoorState)
                .updateValue(isClosed ? Characteristic.TargetDoorState.CLOSED : Characteristic.TargetDoorState.OPEN, undefined, 'fromHTTPWebhooks');

            this.storage.setItemSync("http-webhook-"+this.id, newState);
        };
        this.changeHandler = (function(newState) {
            var currentState = this.service.getCharacteristic(Characteristic.CurrentDoorState).value;
            if ((this.reverse && currentState === Characteristic.CurrentDoorState.CLOSING) ||
                (!this.reverse && currentState === Characteristic.CurrentDoorState.OPENING)) {
                this.log("Record HomeKit state for garage door to '%s'.", newState);
                this.storage.setItemSync("http-webhook-"+this.id, newState);
                return;
            }

            this.log("Change HomeKit state for garage door to '%s'.", newState);

            this.writeState(newState);
        }).bind(this);

        this.service.getCharacteristic(Characteristic.CurrentDoorState)
            .on('get', this.getState.bind(this));
        this.service.getCharacteristic(Characteristic.TargetDoorState)
            .on('get', this.getState.bind(this))
            .on('set', this.setState.bind(this));
    } else {
        this.service = new Service.Door(this.name);
        this.writeState = function(newState) {
            var intState = newState ? 1 : 0,
                isClosed = intState !== this.reverse;

            this.service.getCharacteristic(Characteristic.CurrentPosition)
                .setValue(isClosed ? 0 : 100, undefined, 'fromHTTPWebhooks');

            this.service.getCharacteristic(Characteristic.TargetPosition)
                .updateValue(isClosed ? 0 : 100, undefined, 'fromHTTPWebhooks');

            this.storage.setItemSync("http-webhook-"+this.id, newState);
        };
        this.changeHandler = (function(newState) {
            var currentState = this.service.getCharacteristic(Characteristic.PositionState).value;
            if ((this.reverse && currentState === Characteristic.PositionState.DECREASING) || (!this.reverse && currentState === Characteristic.PositionState.INCREASING)) return;

            this.log("Change HomeKit state for door to '%s'.", newState);

            this.writeState(newState);
        }).bind(this);

        this.service.getCharacteristic(Characteristic.CurrentPosition)
            .on('get', this.getState.bind(this));
        this.service.getCharacteristic(Characteristic.TargetPosition)
            .on('get', this.getState.bind(this))
            .on('set', this.setState.bind(this));
    }

    if (this.stateURL) {
        this.log("Getting state of '%s'...", this.id);
        request.get({
            url: this.stateURL,
            timeout: DEFAULT_REQUEST_TIMEOUT
        }, (function(err, response, body) {
            var statusCode = response && response.statusCode ? response.statusCode: -1;
            this.log("Request to '%s' finished with status code '%s' and body '%s'.", this.stateURL, statusCode, body, err);
            if (!err && statusCode == 200) {
                try {
                    var res = JSON.parse(body);
                    if (res.hasOwnProperty('success')) {
                        this.storage.setItemSync("http-webhook-"+this.id, res.status);
                    }
                } catch (ex) {
                    this.log(ex);
                }
            }
        }).bind(this));
    }
}

HttpWebHookDoorAccessory.prototype.getState = function(callback) {
    this.log("Getting current state for '%s'...", this.id);

    var state = this.storage.getItemSync("http-webhook-"+this.id),
        intState = state ? 1 : 0;

    this.log("        current state is", state);
    if(this.type === "garage") {
        callback(null, intState === this.reverse ? Characteristic.CurrentDoorState.OPEN : Characteristic.CurrentDoorState.CLOSED);
    }
    else {
        callback(null, intState === this.reverse ? 100 : 0);
    }
};

HttpWebHookDoorAccessory.prototype.setState = function(state, callback) {
    this.log("Switch state for '%s' to '%s'...", this.id, state);

    var currentState,
        isClosed;

    if(this.type === "garage") {
        currentState = this.service.getCharacteristic(Characteristic.CurrentDoorState).value;
        if (currentState === Characteristic.CurrentDoorState.CLOSING || currentState === Characteristic.CurrentDoorState.OPENING) return;

        isClosed = currentState === Characteristic.CurrentDoorState.CLOSED;
        if ((isClosed && state === Characteristic.TargetDoorState.CLOSED) || (!isClosed && state == Characteristic.TargetDoorState.OPEN)) return callback(null);
    } else {
        currentState = this.service.getCharacteristic(Characteristic.PositionState).value;
        if (currentState === Characteristic.PositionState.INCREASING || currentState === Characteristic.PositionState.DECREASING) return;

        isClosed = currentState === 0;
        if ((isClosed && state === 0) || (!isClosed && state == 100)) return callback();
    }

    var urlToCall = this.openURL;
    if(state) {
        urlToCall = this.closeURL;
    }
    if(urlToCall !== "") {
        request.get({
            url: urlToCall,
            timeout: DEFAULT_REQUEST_TIMEOUT
        }, (function(err, response, body) {
            var statusCode = response && response.statusCode ? response.statusCode: -1;
            this.log("Request to '%s' finished with status code '%s' and body '%s'.", urlToCall, statusCode, body, err);
            if (!err && statusCode == 200) {
                this.storage.setItemSync("http-webhook-"+this.id, state);

                try {
                    var res = JSON.parse(body);
                    if (res.hasOwnProperty('success')) {
                        var deferCallback = false;
                        if (res.success) {

                            if (this.type === "garage") {
                                this.service.getCharacteristic(Characteristic.CurrentDoorState)
                                    .setValue(isClosed ? Characteristic.CurrentDoorState.OPENING : Characteristic.CurrentDoorState.CLOSING, undefined, 'fromHTTPWebhooks');
                            } else {
                                this.service.getCharacteristic(Characteristic.PositionState)
                                    .setValue(isClosed ? Characteristic.PositionState.INCREASING : Characteristic.PositionState.DECREASING, undefined, 'fromHTTPWebhooks');
                            }

                            if ((!isClosed ? 1 : 0) === this.reverse) {
                                this.log('Got to manually update end state in %dms', this.duration / 1000);
                                deferCallback = true;

                                setTimeout(function() {
                                    var state = this.storage.getItemSync("http-webhook-"+this.id);
                                    if (isClosed !== state) {
                                        this.service.getCharacteristic(Characteristic.CurrentDoorState)
                                            .setValue(Characteristic.CurrentDoorState.STOPPED, undefined, 'fromHTTPWebhooks');
                                        callback();
                                        setTimeout(function() {
                                            this.writeState(state);
                                        }.bind(this), 1000);
                                    } else {
                                        this.writeState(state);
                                        callback();
                                    }
                                }.bind(this), this.duration);
                            }

                        } else {
                            this.writeState(res.status);
                        }
                        return deferCallback ? null : callback();
                    }
                } catch (ex) {
                    this.log(ex);
                }
            }

            callback(err || new Error("Request to '"+url+"' was not succesful."));
        }).bind(this));
    }
};

HttpWebHookDoorAccessory.prototype.getServices = function() {
    return [this.service];
};