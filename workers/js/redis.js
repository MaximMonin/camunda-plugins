// Lock and unlock containers with redis redlock
// Set and Get records to multiplay redis servers

const {createClient} = require('redis');
const Redlock = require('redlock');
const MultipleRedis = require('multiple-redis');
const {promisify} = require('util');

const log = (type, fn) => fn ? () => {
	console.log(`Redis: ${type}`);
} : console.log(`Redis: ${type}`);

class Redis {
  constructor(urls) {
    this.urls = urls.split(',');
    this.redisServers = [];
    for (var i = 0; i < this.urls.length; i++) {
      var client = createClient('redis://' + this.urls[i],{
        password: process.env.RedisPass,
        retry_strategy: function(options) {
          if (options.error && (options.error.code === 'ECONNREFUSED' || options.error.code === 'NR_CLOSED')) {
            // Try reconnecting after 5 seconds
            console.error('The server refused the connection. Retrying connection...');
            return 5000;
          }
          // reconnect after
          return Math.min(options.attempt * 200, 10000);
        },
      });
      client.on('connect'     , log(client.address + ' connected', true));
      client.on('reconnecting', log(client.address + ' reconnecting...', true));
      client.on('error'       , log(client.address + ' error', true));
      client.on('end'         , log(client.address + ' closed', true));
      client.on ('subscribe', function (channel) {
        console.log('subscriber: ' + this.address + ' subscribes on ' + channel);
      });
      client.on('unsubscribe',  function (channel) {
        console.log('subscriber: ' + this.address + ' unsubscribes from ' + channel);
      });
      client.on ('psubscribe', function (pattern) {
        console.log('subscriber: ' + this.address + ' subscribes on ' + pattern);
      });
      client.on ('punsubscribe', function (pattern) {
        console.log('subscriber: ' + this.address + ' unsubscribes from ' + pattern);
      });

      this.redisServers.push (client);
    }
    this.redlock = new Redlock( this.redisServers,
    {
	retryCount:  20,
	retryDelay:  200, // time in ms
	retryJitter:  200 // time in ms
    });
    this.multiClient = MultipleRedis.createClient(this.redisServers);
  }
  get(key, callback) {
    this.multiClient.get(key, callback);
  }
  getAsync = promisify(this.get).bind(this);
  set(key, value, timeout, callback) {
    this.multiClient.setex(key, timeout, value, callback);
  }
  setAsync = promisify(this.set).bind(this);
  publish(channel, message) {
    this.multiClient.publish(channel, message);
  }
  subscribe(channel, callback) {
    for (var i = 0; i < this.redisServers.length; i++) {
      this.redisServers[i].subscribe(channel, callback);
    }
  }
  on(message, callback) {
    for (var i = 0; i < this.redisServers.length; i++) {
      this.redisServers[i].on(message, callback);
    }
  }
  unsubscribe(channel) {
    for (var i = 0; i < this.redisServers.length; i++) {
      this.redisServers[i].unsubscribe(channel);
    }
  }
  psubscribe(channel, callback) {
    for (var i = 0; i < this.redisServers.length; i++) {
      this.redisServers[i].psubscribe(channel, callback);
    }
  }
  punsubscribe(channel) {
    for (var i = 0; i < this.redisServers.length; i++) {
      this.redisServers[i].punsubscribe(channel);
    }
  }
  stop () {
    for (var i = 0; i < this.redisServers.length; i++)
    {
      this.redisServers[i].quit(function (err, res) {});
      this.redisServers[i].end(true);
    }
  }
}

module.exports = {Redis, Redlock};
