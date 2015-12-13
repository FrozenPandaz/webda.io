var uriTemplates = require('uri-templates');
var Executors = require('./executor.js');
var extend = require('util')._extend;

//var module = require("module");
var Router = function(config) {
	var self = this;
	self.config = config;
	// Prepare tbe URI parser
	for (var vhost in this.config) {
		for (var map in this.config[vhost]) {
      if (this.config[vhost][map]._extended) {
        continue;
      }
      if (this.config[vhost][map]["executor"] == undefined) {
          this.config[vhost][map]["executor"] = "_default";
      } else {
        // Validate the Executor type
        if (Executors[this.config[vhost][map]["executor"]] == undefined) {
           throw "Executor type is unknown: '" + this.config[vhost][map]["executor"] + "'";
        }
      }
			if (map.indexOf("{") != -1) {
		    this.config[vhost][map]['uri-template-parse'] = uriTemplates(map);
		  }
      callable = new Executors[this.config[vhost][map]["executor"]](this.config[vhost][map]);
      for (var extMap in callable.enrichRoutes(map)) {
        if (this.config[vhost][extMap] != undefined) {
          continue;
        }
        this.config[vhost][extMap] = extend({}, this.config[vhost][map]);

        if (map.indexOf("{") != -1) {
          this.config[vhost][extMap]['uri-template-parse'] = uriTemplates(extMap);
        }
        this.config[vhost][extMap]._extended = true;
      }
		}
	}
};
Router.prototype = Router;

Router.prototype.initHosts = function(vhost, config) {
  console.log("init stores");
  if (config.global == undefined || config.global.stores == undefined) {
    return;
  }
  stores = require('./store');
  // Handle Mapping and Expose
  for (store in config.global.stores) {
    storeName = vhost + "_" + store;
    console.log("Adding store: " + storeName);
    config.global.stores[store].name = storeName;
    stores.add(storeName, config.global.stores[store]);
    if (config.global.stores[store].map != undefined) {
        var map = config.global.stores[store].map;
        if (map != undefined && map._init == undefined) {
          maps = {}
          for (prop in map) {
            if (config.global.stores[prop] != undefined) {
                if (config.global.stores[prop].reverseMap == undefined) {
                    config.global.stores[prop].reverseMap = [];
                }
                config.global.stores[prop].reverseMap.push(map[prop].target);
            }
            maps[vhost + '_' + prop]=map[prop];
          }
          map = maps;
          map._init = true;
        }
        config.global.stores[store].map = map
    }
    if (config.global.stores[store].expose != undefined) {
      var expose = config.global.stores[store].expose;
      if (typeof(expose) == "boolean") {
        expose = {};
        expose.url = "/" + store;
      } else if (typeof(expose) == "string") {
        url = expose;
        expose = {};
        expose.url = url;
      } else if (typeof(expose) == "object" && expose.url == undefined) {
        expose.url = "/" + store;
      }
      if (expose.restrict == undefined) {
        expose.restrict = {}
      }
      
      config[expose.url] = {"method": ["POST", "GET"], "executor": "store", "store": storeName, "expose": expose, "map": config.global.stores[store].map};
      config[expose.url+"/{uuid}"] = {"method": ["GET", "PUT", "DELETE"], "executor": "store", "store": storeName, "expose": expose, "map": config.global.stores[store].map, "uri-template-parse": uriTemplates(expose.url + "/{uuid}")};
    }
  }
  // Handle CASCADE
  for (var storeId in config.global.stores) {
      var store = config.global.stores[storeId];
      // Check if store has cascade
      if (store.cascade == undefined) {
        continue;
      }
      // For each cascade
      for (var i in store.cascade) {
        // Search mapping to this collection ( only one way collection handled for now )
        for (var mapStoreId in config.global.stores) {
          if (mapStoreId == storeId) {
            continue;
          }
          var mapStore = config.global.stores[mapStoreId];
          // Check if map is targetting the current store / cascade
          if (mapStore.map == undefined || mapStore.map[store.name] == undefined || mapStore.map[store.name].target != store.cascade[i]) {
            continue;
          }
          store.cascade[i] = {"name": store.cascade[i], "store": mapStore.name};
          //console.log("FOUND MAPPING TO " + store.name + " mapping name " + store.cascade[i] + " : " + JSON.stringify(mapStore.map[store.cascade[i]]));
        }
      }
  }
  if (config.global == undefined || config.global.validators == undefined) {
    return;
  }
  //require(config.global.validators);
}

Router.prototype.getRoute = function(vhost, method, url, protocol, port, headers) {
  // Check vhost
  if (this.config[vhost] === undefined) {
  	return null;
  } else {
    // Init vhost if needed
    this.initHosts(vhost, this.config[vhost]);
  }
  // Check mapping
  var callable = null;
  if (url.indexOf("?") >= 0) {
    url = url.substring(0, url.indexOf("?"));
  }
  for (var map in this.config[vhost]) {
    if (map == "global") {
      continue;
    }
    console.log("Going through mapping: " + map);
    if  (Array.isArray(this.config[vhost][map]['method'])) {
      if (this.config[vhost][map]['method'].indexOf(method) == -1) {
        continue;
      }
    } else if (this.config[vhost][map]['method'] != method) {
      continue;
    }
    if (map == url) {
      callable = new Executors[this.config[vhost][map]["executor"]](this.config[vhost][map]);
      break;
    }
    if (this.config[vhost][map]['uri-template-parse'] === undefined) {
      continue;
    }
    //console.log(url);
    //console.log(this.config[vhost][map]);
    parse_result = this.config[vhost][map]['uri-template-parse'].fromUri(url);
    //console.log(parse_result);
    if (parse_result != undefined) {
      var skip = false;
      for (var val in parse_result) {
        if (parse_result[val].indexOf("/") >= 0) {
          skip = true;
          break;
        }
      }
      if (skip) {
        continue;
      }
      callable = new Executors[this.config[vhost][map]["executor"]](this.config[vhost][map]);
      callable.enrichParameters(parse_result);
      break;
    }
  }
  if (callable != null) {
  	vhost_config = this.config[vhost]["global"];
  	if (vhost_config['params'] != undefined) {
        callable.enrichParameters(vhost_config['params']);
  	}
    if (callable["_http"] == undefined) {
        callable["_http"] = {"host":vhost, "method":method, "url":url, "protocol": protocol, "port": port, "headers": headers};
    }
  }
  return callable;
};

module.exports = Router.prototype;