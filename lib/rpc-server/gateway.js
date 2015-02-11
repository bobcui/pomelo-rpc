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
  this.dispatchEnqueue = opts.dispatchEnqueue || false;
  this.started = false;
  this.stoped = false;
  this.acceptorFactory = opts.acceptorFactory || defaultAcceptorFactory;
  this.services = opts.services;
  this.dispatcher = new Dispatcher(this.services);
  if(!!this.opts.reloadRemotes) {
    watchServices(this, this.dispatcher);
  }
  var msgProcessCB;
  if (this.dispatchEnqueue) {
    this.dispatchInterval = opts.dispatchInterval || 50;
    this.dispatchCountOnce = opts.dispatchCountOnce || 0;
    this.msgMaxPriority = opts.msgMaxPriority || 10;
    if (this.dispatchCountOnce <= 0) {
      this.dispatchCountOnce = (1 << 30)
    }
    this.dispatchQueue = [];
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

  if (this.dispatchEnqueue) {
    setInterval(this.dispatchQueuedMsg.bind(this), this.dispatchInterval)
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

  if (!this.dispatchQueue[priority]) {
    this.dispatchQueue[priority] = []
  }
  this.dispatchQueue[priority].push([tracer, msg, cb])
};

pro.dispatchQueuedMsg = function() {
  var count = this.dispatchCountOnce;
  var i, j;
console.time('dispatchQueuedMsg')  
  for (i=0; i<this.dispatchQueue.length; ++i) {
    var queue = this.dispatchQueue[i]
    if (!!queue && queue.length>0) {
      for (j=0; j<queue.length; ++j) {
        this.dispatcher.route.apply(this.dispatcher, queue[j])
        count--
        if (!count) {
          break
        }
      }
      this.dispatchQueue[i] = queue.slice(j)

      if (!count) {
        break
      }
    }
  }
console.timeEnd('dispatchQueuedMsg')  
console.log('process %s msg', this.dispatchCountOnce - count)
};

pro.getQueuedMsgCount = function() {
  var count
  for (i=0; i<this.dispatchQueue.length; ++i) {
    if (!!this.dispatchQueue[i]) {
      count += this.dispatchQueue[i].length
    }
  }
  return count  
}

pro.setDispatchCountOnce = function(dispatchCountOnce) {
  this.dispatchCountOnce = dispatchCountOnce
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

