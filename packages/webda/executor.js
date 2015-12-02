var uuid = require('node-uuid');
var Executor = function (callable) {
	self = this;
	self.callable = callable;
	self.params = callable.params;
	if (self.params == undefined) {
		self.params = {}; 
	}
};

Executor.prototype = Executor;

Executor.prototype.execute = function(req, res) {
	res.writeHead(200, {'Content-Type': 'text/plain'});
  	res.write("Callable is " + JSON.stringify(callable));
  	res.end();
};

Executor.prototype.getStore = function(name) {
	storeName = name;
	if (this.callable.stores != undefined && this.callable.stores[name] != undefined) {
		storeName = this.callable.stores[name];
	}
	if (this._http != undefined && this._http.host != undefined) {
		storeName = this._http.host + "_" + storeName;
	}
	res = require("./store").get(storeName);
	return res;
}

Executor.prototype.enrichRoutes = function(map) {
	return {};
};

Executor.prototype.enrichParameters = function(params) {
	for (var property in params) {
    	if (this.params[property] == undefined) {
      		this.params[property] = params[property];
    	}
  	}
};

CustomExecutor = function(params) {
	Executor.call(this, params);
	this._type = "CustomExecutor";
};

CustomExecutor.prototype = Object.create(Executor.prototype);

CustomExecutor.prototype.execute = function(req, res) {
	this.params["_http"] = this._http;
};

CustomExecutor.prototype.handleResult = function(data, res) {
	try {
		// Should parse JSON
      	result = JSON.parse(data);		
      	if (result.code == undefined) {
      		result.code = 200;
      	}
      	if (result.headers == undefined) {
      		result.headers = {}
      	}
      	if (result.headers['Content-Type'] == undefined) {
      		result.headers['Content-Type'] = 'application/json';
      	}
      	if (result.code == 200 && (result.content == undefined || result.content == "")) {
      		result.code = 204;
      	}
    } catch(err) {
      	console.log("Error '" + err + "' parsing result: " + data);
      	res.writeHead(500);
      	res.end();
		return;
	}
	res.writeHead(result.code, result.headers);
	if (result.content != undefined) {
    	res.write(result.content);
    }
    res.end();
}

var AWS = require('aws-sdk');

LambdaExecutor = function(params) {
	CustomExecutor.call(this, params);
	this._type = "LambdaExecutor";
};

LambdaExecutor.prototype = Object.create(CustomExecutor.prototype);

LambdaExecutor.prototype.execute = function(req, res) {
	console.log(AWS.Config);
	AWS.config.update({region: 'us-west-2'});
	AWS.config.update({accessKeyId: this.params['accessKeyId'], secretAccessKey: this.params['secretAccessKey']});
	var lambda = new AWS.Lambda();
	this.params["_http"] = this._http;
	var params = {
		FunctionName: this.callable['lambda'], /* required */
		ClientContext: null,
		InvocationType: 'RequestResponse',
		LogType: 'None',
		Payload: JSON.stringify(this['params'])// not sure here / new Buffer('...') || 'STRING_VALUE'
    };
  	lambda.invoke(params, function(err, data) {
    	if (err) {
      		console.log(err, err.stack);
      		res.writeHead(500, {'Content-Type': 'text/plain'});
      		res.end();
      		return;
    	}
    	if (data.Payload != '{}') {
    		self.handleResult(data.Payload, res);
    	}
  	});
};

var fs = require('fs');
var mime = require('mime-types');

ResourceExecutor = function(params) {
	Executor.call(this, params);
	this._type = "ResourceExecutor";
};

ResourceExecutor.prototype = Object.create(Executor.prototype);

ResourceExecutor.prototype.execute = function(req, res) {
	fs.readFile(this.callable.file, 'utf8', function (err,data) {
	  if (err) {
	    return console.log(err);
	  }
	  mime_file = mime.lookup(self.callable.file);
	  console.log("Send file('" + mime_file + "'): " + self.callable.file);
	  if (mime_file) {
	  	res.writeHead(200, {'Content-Type': mime_file});
	  }
	  res.write(data);
	  res.end();
	});
};

FileExecutor = function(params) {
	CustomExecutor.call(this, params);
	this._type = "FileExecutor";
};

FileExecutor.prototype = Object.create(CustomExecutor.prototype);

FileExecutor.prototype.execute = function(req, res) {
	req.context = this.params;
	if (this.callable.type == "lambda") {
		// MAKE IT local compatible
		data = require(this.callable.file)(params, {});
		this.handleResult(data, res);
	} else {
		require(this.callable.file)(req, res);
	}
};

StringExecutor = function(params) {
	Executor.call(this, params);
	this._type = "StringExecutor";
};

StringExecutor.prototype = Object.create(Executor.prototype);

StringExecutor.prototype.execute = function(req, res) {
	if (this.callable.mime) {
	   res.writeHead(200, {'Content-Type': this.callable.mime});
	}
	if (typeof this.callable.result != "string") {
		res.write(JSON.stringify(this.callable.result));
	} else {
		res.write(this.callable.result);
	}
	res.end();
};

InlineExecutor = function(params) {
	Executor.call(this, params);
	this._type = "InlineExecutor";
};

InlineExecutor.prototype = Object.create(Executor.prototype);

InlineExecutor.prototype.execute = function(req, res) {
	console.log("Will evaluate : " + this.callable.callback);
	eval("callback = " + this.callable.callback);
	console.log("Inline Callback type: " + typeof(callback));
	req.context = this.params;
	if (typeof(callback) == "function") {
		callback(req, res);
		console.log("end executing inline");
	} else {
		console.log("Cant execute the inline as it is not a function");
		res.writeHead(500);
		res.end();
	}
}

StoreExecutor = function(params) {
	Executor.call(this, params);
	this._type = "StoreExecutor";
};

StoreExecutor.prototype = Object.create(Executor.prototype);

StoreExecutor.prototype.handleMap = function(object, map, updates) {
	stores = require("./store");
	/*
	"map": {
		"users": {
			"key": "user",
			"target": "idents",
			"fields": "type"
		}
	}
	*/
	for (prop in map) {
		// No mapped property or not in the object
		if (map[prop].key == undefined || object[map[prop].key] == undefined) {
			continue;
		}
		store = stores.get(prop)
		// Cant find the store for this collection
		if (store == undefined) {
			continue;
		}
		mapped = store.get(object[map[prop].key]);
		// Invalid mapping
		if (mapped == undefined) {
			continue;
		}
		if ( updates == "created" ) {
			// Add to the object
			mapper = {};
			mapper.uuid = object.uuid;
			// Add info to the mapped
			if (map[prop].fields) {
				fields = map[prop].fields.split(",");
				for (field in fields) {
					mapper[fields[field]] = object[fields[field]];
				}
			}
			mapped[map[prop].target][mapper.uuid]=mapper;
			// TODO Should be update
			store.save(mapped, mapped.uuid);
		} else if (updates == "deleted") {
			// Remove from the collection
			if (mapped[map[prop].target][object.uuid] == undefined) {
				continue;
			}
			delete mapped[map[prop].target][object.uuid];
			// TODO Should be update
			store.save(mapped, mapped.uuid);
		} else if (typeof(updates) == "object") {
			// Update only if the key field has been updated
			found = false;
			for (field in updates) {
				if (map[prop].fields) {
					fields = map[prop].fields.split(",");
					for (mapperfield in fields) {
						if (fields[mapperfield] == field) {
							found = true;
							break;
						}
					}
				}
				// TODO Need to verify also if fields are updated
				if (field == map[prop].key) {
					found = true;
					break;
				}
			}
			if (!found) {
				continue;
			}
			// check if reference object has changed
			if (updates[map[prop].key] != undefined && mapped.uuid != updates[map[prop].key]) {
				if (mapped[map[prop].target][object.uuid] != undefined) {
					delete mapped[map[prop].target][object.uuid];
					store.save(mapped, mapped.uuid);
				}
				// TODO Should be update
				mapped = store.get(updates[map[prop].key])
				if (mapped == undefined) {
					continue
				}
			}
			// Update the mapper
			mapper = {};
			mapper.uuid = object.uuid;
			if (map[prop].fields) {
				fields = map[prop].fields.split(",");
				for (field in fields) {
					mapper[fields[field]] = object[fields[field]];
				}
			}
			mapped[map[prop].target][mapper.uuid]=mapper;
			// Remove old reference
			console.log("update ...");
			store.save(mapped, mapped.uuid);
		}
	}
}

StoreExecutor.prototype.execute = function(req, res) {
	store = require("./store").get(this.callable.store);
	if (store == undefined) {
		console.log("Unkown store: " + this.callable.store);
		res.writeHead(500);
		res.end();
		return;
	}
	if (this._http.method == "GET") {
		if (this.params.uuid) {
			object = store.get(this.params.uuid);
			res.writeHead(200, {'Content-type': 'application/json'});
			result = {}
			for (prop in object) {
				// Server private property
				if (prop[0] == "_") {
					continue
				}
				result[prop] = object[prop]
			}
			res.write(JSON.stringify(object));
			res.end();
			return;
		} else {
			// List probably
		}
	} else if (this._http.method == "DELETE") {
		if (this.callable.expose.restrict != undefined
				&& this.callable.expose.restrict.delete) {
			res.writeHead(404);
			res.end();
		}
		if (this.params.uuid) {
			// Update external links
			if (this.callable.expose.map != undefined) {
				object = store.get(this.params.uuid);
				this.handleMap(object, this.callable.expose.map, "deleted");
			}
			store.delete(this.params.uuid);
			res.writeHead(204);
			res.end();
			return;
		}
	} else if (this._http.method == "POST") {
		object = req.body;
		if (this.callable.expose.restrict != undefined
				&& this.callable.expose.restrict.create) {
			res.writeHead(404);
			res.end();
		}
		if (!object.uuid) {
			object.uuid = uuid.v4();
		}
		if (store.exists(object.uuid)) {
			res.write(409);
			res.end();
			return;
		}
		for (prop in object) {
			if (prop[0] == "_") {
				delete object[prop]
			}
		}
		new_object = store.save(object, object.uuid);
		// Update external links
		if (this.callable.expose.map != undefined) {
			this.handleMap(new_object, this.callable.expose.map, "created");
		}
		res.writeHead(200, {'Content-type': 'application/json'});
		res.write(JSON.stringify(new_object));
		res.end();
		return;
	} else if (this._http.method == "PUT") {
		if (this.callable.expose.restrict != undefined
				&& this.callable.expose.restrict.update) {
			res.writeHead(404);
			res.end();
		}
		if (!store.exists(this.params.uuid)) {
			res.write(404);
			res.end();
			return;
		}
		for (prop in req.body) {
			if (prop[0] == "_") {
				delete req.body[prop]
			}
		}
		saved = store
		// Update external links
		if (this.callable.expose.map != undefined) {
			object = store.get(this.params.uuid);
			this.handleMap(object, this.callable.expose.map, req.body);
		}
		store = saved
		object = store.update(req.body, this.params.uuid);
		if (object == undefined) {
			res.writeHead(500);
			res.end();
			return;
		}
		res.writeHead(200, {'Content-type': 'application/json'});
		res.write(JSON.stringify(object));
		res.end();
		return;
	}
	res.writeHead(404);
	res.end();
}

var passport = require('passport');
var TwitterStrategy = require('passport-twitter').Strategy;
var FacebookStrategy = require('passport-facebook').Strategy;
var GitHubStrategy = require('passport-github2').Strategy;

var Ident = function (type, uid, accessToken, refreshToken) {
	this.type = type;
	this.uid = uid;
	this.uuid = type + "_" + uid;
	this.tokens = {};
	this.tokens.refresh = refreshToken;
	this.tokens.access = accessToken;
}

Ident.prototype = Ident;

Ident.prototype.getUser = function() {
	return this.user;
}

Ident.prototype.setUser = function(user) {
	this.user = user;
}

Ident.prototype.setMetadatas = function(meta) {
	this.metadatas = meta;
}

Ident.prototype.getMetadatas = function() {
	return this.metadatas;
}

passport.serializeUser(function(user, done) {
  done(null, JSON.stringify(user));
});

passport.deserializeUser(function(id, done) {
  done(null, JSON.parse(id));
});

PassportExecutor = function(params) {
	Executor.call(this, params);
	this._type = "PassportExecutor";
}

PassportExecutor.prototype = Object.create(Executor.prototype);


PassportExecutor.prototype.enrichRoutes = function(map) {
	result = {};
	result[map+'/callback']={};
	result[map+'/return']={};
	return result;
};

PassportExecutor.prototype.executeCallback = function(req, res) {
	next = function (err) {
		console.log("Error happened: " + err);
		console.trace();
	}
	switch (self.params.provider) {
		case "facebook":
			self.setupFacebook(req, res);
			passport.authenticate('facebook', { successRedirect: self.callable.successRedirect, failureRedirect: self.callable.failureRedirect})(req, res, next);
			return;
		case "github":
			self.setupGithub(req, res);
			passport.authenticate('github', { successRedirect: self.callable.successRedirect, failureRedirect: self.callable.failureRedirect})(req, res, next);
			return;
	}
};

PassportExecutor.prototype.getCallback = function () {
	if (self.callable._extended) {
		callback = "http://" + self._http.headers.host + self._http.url;
	} else {
		callback = "http://" + self._http.headers.host + self._http.url + "/callback";
	}
	return callback;
};

PassportExecutor.prototype.setupGithub = function(req, res) {
	callback = self.getCallback();
	passport.use(new GitHubStrategy({
		    clientID: self.callable.providers.github.clientID,
		    clientSecret: self.callable.providers.github.clientSecret,
		    callbackURL: callback
		},
		function(accessToken, refreshToken, profile, done) {
		    console.log("return from github: " + JSON.stringify(profile));
		    req.session.authenticated = new Ident("github", profile.id, accessToken, refreshToken);
		    req.session.authenticated.setMetadatas(profile._json);
		    self.store(req.session);
		    done(null, req.session.authenticated);
		}
	));
}

PassportExecutor.prototype.store = function(session) {
	identStore = this.getStore("idents");
	if (identStore == undefined) {
		return;
	}
	identObj = identStore.get(session.authenticated.uuid);
	if (identObj == undefined) {
		identObj = session.authenticated;
	} else {
		identObj.metadatas = session.authenticated.metadatas;
	}
	identObj.lastUsed = new Date();
	// TODO Add an update method for updating only attribute
	identStore.save(identObj, identObj.uuid);
	if (identObj.user != undefined) {
		userStore = self.getStore("users");
		if (userStore == undefined) {
			return;
		}
		session.currentuser = userStore.get(identObj.user);
	}
}

PassportExecutor.prototype.setupFacebook = function(req, res) {
	callback = self.getCallback();
	passport.use(new FacebookStrategy({
		    clientID: self.callable.providers.facebook.clientID,
		    clientSecret: self.callable.providers.facebook.clientSecret,
		    callbackURL: callback
		},
		function(accessToken, refreshToken, profile, done) {
		    console.log("return from fb: " + JSON.stringify(profile));
            req.session.authenticated = new Ident("facebook", profile.id, accessToken, refreshToken);
            // Dont store useless parts
            delete profile._raw;
            delete profile._json;
		    req.session.authenticated.setMetadatas(profile);
		    self.store(req.session);
		    console.log("Test" + req.session.currentuser);
		    done(null, req.session.currentuser);
		}
	));
}

PassportExecutor.prototype.execute = function(req, res) {
	req._passport = {};
	req._passport.instance = passport;
	req._passport.session = req.session;
	if (self.callable._extended ) {
		self.executeCallback(req, res);
		return;
	}
	switch (self.params.provider) {
		case "facebook":
			self.setupFacebook();
			passport.authenticate('facebook', {'scope': self.callable.providers.facebook.scope})(req, res);
			return;
		case "github":
			self.setupGithub();
			passport.authenticate('github', {'scope': self.callable.providers.github.scope})(req, res);
			return;

	}
	res.end();
};
module.exports = {"_default": LambdaExecutor, "custom": CustomExecutor, "inline": InlineExecutor, "lambda": LambdaExecutor, "debug": Executor, "store": StoreExecutor, "string": StringExecutor, "resource": ResourceExecutor, "file": FileExecutor , "passport": PassportExecutor}; 
