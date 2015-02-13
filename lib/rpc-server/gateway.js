var EventEmitter = require('events').EventEmitter;
var util = require('util');
var utils = require('../util/utils');
var defaultAcceptorFactory = require('./acceptor');
var Dispatcher = require('./dispatcher');
var fs = require('fs');
var Loader = require('pomelo-loader');

var Gateway = function(opts) {
  EventEmitter.call(this);
  this.opts = opts || {};
  this.port = opts.port || 3050;
  this.host = opts.host || '0.0.0.0';
  this.handleEnqueue = opts.handleEnqueue || false;
  this.started = false;
  this.stoped = false;
  this.acceptorFactory = opts.acceptorFactory || defaultAcceptorFactory;
  this.services = opts.services;
  this.dispatcher = new Dispatcher(this.services);
  if(!!this.opts.reloadRemotes) {
    watchServices(this, this.dispatcher);
  }
  var msgProcessCB;
  if (this.handleEnqueue) {
    this.handleInterval = opts.handleInterval || 0;
    this.handleCountOnce = opts.handleCountOnce || 0;
    this.msgMaxPriority = opts.msgMaxPriority || 10;
    if (this.handleCountOnce <= 0) {
      this.handleCountOnce = (1 << 30)
    }
    this.handleQueue = [];
    msgProcessCB = this.queueMsg.bind(this);
  }
  else {
    msgProcessCB = this.dispatcher.route.bind(this.dispatcher);
  }

  this.acceptor = this.acceptorFactory.create(opts, msgProcessCB);
};
util.inherits(Gateway, EventEmitter);

var pro = Gateway.prototype;

pro.stop = function() {
  if(!this.started || this.stoped) {
    return;
  }
  this.stoped = true;
  try {
    this.acceptor.close();
  } catch(err) {}
};

pro.start = function() {
  if(this.started) {
    throw new Error('gateway already start.');
  }
  this.started = true;

  var self = this;
  this.acceptor.on('error', self.emit.bind(self, 'error'));
  this.acceptor.on('closed', self.emit.bind(self, 'closed'));
  this.acceptor.listen(this.port, this.host);

  if (this.handleEnqueue) {
    setTimeout(this.handleQueueMsg.bind(this), this.handleInterval)
  }
};

pro.queueMsg = function(tracer, msg, cb) {
  var priority
  if (!msg.priority || msg.priority < 0) {
    priority = 0
  }
  else {
    priority = msg.priority
    if (priority > this.msgMaxPriority) {
      priority = this.msgMaxPriority
    }
  }

  if (!this.handleQueue[priority]) {
    this.handleQueue[priority] = []
  }
  this.handleQueue[priority].push([tracer, msg, cb])
};

pro.handleQueueMsg = function() {
  var count = 0;
  var i, j;
  for (i=0; i<this.handleQueue.length; ++i) {
    var queue = this.handleQueue[i]
    if (!!queue) {      
      while (queue.length > 0) {
        var args = queue.pop()
        this.dispatcher.route.apply(this.dispatcher, args)
        count++
        if (count >= this.handleCountOnce) {
          setTimeout(this.handleQueueMsg.bind(this), 0)
          return
        }
      }
    }
  }

  setTimeout(this.handleQueueMsg.bind(this), this.handleInterval)
};

pro.getHandleQueueLength = function() {
  if (!this.handleQueue) {
    return null
  }

  var count = 0
  for (var i=0; i<this.handleQueue.length; ++i) {
    if (!!this.handleQueue[i]) {
      count += this.handleQueue[i].length
    }
  }
  return count  
}

pro.sethandleCountOnce = function(handleCountOnce) {
  this.handleCountOnce = handleCountOnce
}

/**
 * create and init gateway
 *
 * @param opts {services: {rpcServices}, connector:conFactory(optional), router:routeFunction(optional)}
 */
module.exports.create = function(opts) {
  if(!opts || !opts.services) {
    throw new Error('opts and opts.services should not be empty.');
  }

  return new Gateway(opts);
};


var watchServices = function(gateway, dispatcher) {
  var paths = gateway.opts.paths;
  var app = gateway.opts.context;
  for(var i=0; i<paths.length; i++) {
    (function(index) {
      fs.watch(paths[index].path, function(event, name) {
        if(event === 'change') {
          var res = {};
          var item = paths[index];
          var m = Loader.load(item.path, app);
          if(m) {
            createNamespace(item.namespace, res);
            for(var s in m) {
              res[item.namespace][s] = m[s];
            }
          }
          dispatcher.emit('reload', res);
        }
      });
    })(i);
  }
};

var createNamespace = function(namespace, proxies) {
  proxies[namespace] = proxies[namespace] || {};
};
