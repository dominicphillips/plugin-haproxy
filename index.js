var _net = require('net');
var _os = require('os');
var _param = require('./param.json');
var _request = require('request');
var _tools = require('graphdat-plugin-tools');
var _url = require('url');

var _haproxyKeys = [
    'pxname',           // proxy name (ex. http-in)
    'svname',           // service name (FRONTEND or BACKEND_
    'qcur',             // current queued requests (ex 0)
    'qmax',             // max queued requests (ex 0)
    'scur',             // current sessions (ex. 13)
    'smax',             // max sessions (ex. 35)
    'slim',             // session limit (ex. 2000)
    'stot',             // total sessions (ex. 11151)
    'bin',              // bytes in (ex. 1622452007)
    'bout',             // bytes out (ex. 612088528)
    'dreq',             // denied requests (ex. 0 )
    'dresp',            // denied responses (ex. 0)
    'ereq',             // request errors (ex. 84)
    'econ',             // connections errors (ex. 0)
    'eresp',            // response errors like srv_abrt (ex. 0)
    'wretr',            // retries (warning)
    'wredis',           // redispatched (warning)
    'status',           // status (UP/DOWN/NOLB/MAINT/OPEN/CLOSED)
    'weight',           // weighting of the server, or total weight of the backend (ex 1)
    'act',              // server is active (server), number of active servers (backend) (ex. Y)
    'bck',              // server is backup (server), number of backup servers (backend)
    'chkfail',          // number of failed health checks (ex. 0)
    'chkdown',          // number of Up/Down transitions (ex. 0)
    'lastchg',          // how many seconds since the last time the status changed (ex. 523098)
    'downtime',         // total seconds of down time (ex. 65433)
    'qlimit',           // queue limit (ex. 0)
    'pid',              // process Id, 0 for first instance, 1 for second (ex. 1)
    'iid',              // unique proxy id (ex. 7)
    'sid',              // service id (unique within a proxy) (ex. 0)
    'throttle',         // warm up status
    'lbtot',            // total number of times a server was selected
    'tracked',          // id of proxy/server is tracking is enabled
    'type',             // type (0=frontend, 1=backend, 2=server, 3=socked)
    'rate',             // number of sessions per second over last elapsed second
    'rate_lim',         // limit on new sesions per second
    'rate_max',         // max number of new sessions per second
    'check_status',     // status of last health check
    'check_code',       // layer5-7 code if available
    'check_duration',   // time in ms to finish the last health check
    'hrsp_1xx',         // http responses with 1xx codes
    'hrsp_2xx',         // http responses with 2xx codes
    'hrsp_3xx',         // http responses with 3xx codes
    'hrsp_4xx',         // http responses with 4xx codes
    'hrsp_5xx',         // http responses with 5xx codes
    'hrsp_other',       // http responses with other codes (protocol error)
    'hanafail',         // failed health check details
    'req_rate',         // HTTP request per second over last elapsed second
    'req_rate_max',     // max number of HTTP requests per second observerd
    'req_tot',          // total number of HTTP requests received
    'cli_abrt',         // number of data transfers aborted by the client
    'srv_abrt'          // number of data transfers aborted by the server
];

var _getStats = (_param.socketPath) ? getStatsFromSocket : getStatsFromEndpoint; // how to we poll stats
var _httpOptions; // username/password options for the URL
var _pollInterval; // how often do we poll haproxy
var _previous; // remember the previous poll data so we can provide proper counts
var _proxies = {}; // the filters on the haproxy data
var _source; // what name do we show in the legend;
var _ts; // the last time we polled

// At a minimum, we need a way to contact Haproxy
if (!_param.url && !_param.socketPath)
{
    console.error('To get statistics from Haproxy, we need either a URL or a SocketPath');
    process.exit(-1);
}

// If this is a URL, we can ask for a CSV format so it is easier for us to parse
if (_param.url && _param.url.slice(-4) !== ';csv')
    _param.url += ';csv';

// This this is a URL and we have a name and password, then we need to add an auth header
if (_param.url && _param.username)
    _httpOptions = { auth: { user: _param.username, pass: _param.password, sendImmediately: true } };

// If we do not have a source, we prefix everything with the servers hostname
_source = (_param.source || _os.hostname()).trim();

// How often do we poll the endpoint
_pollInterval = (_param.pollSeconds && parseFloat(_param.pollSeconds) * 1000) ||
                (_param.pollInterval) ||
                1000;

// if we have a filter, process it
if (_param.proxies)
{
    _param.proxies.forEach(function(proxy)
    {
        if (!proxy)
            return;

        var values = proxy.split(',');
        if (values[0] in _proxies)
        {
            console.error('The value %s is defined twice.  Each name is requried to be unique', values[0]);
            process.exit(-1);
        }
        _proxies[values[0]] = _source + '-' + (values[1] || values[0]).trim(); // if there is an alias use it
    });
    var _filterProxies = Object.keys(_proxies).length > 0;
}

// get the natural difference between a and b
function diff(a, b, delta)
{
    console.log(delta)
    if (a == null || b == null || delta == null)
        return 0;

    var value = Math.max(a - b, 0) / (delta || 1);
    return Math.round(value);
}

// call the socket object to get the statistics
function getStatsFromSocket(cb)
{
    var error;
    var response = '';

    var client = _net.connect(_param.socketPath, function (err)
    {
        if (err)
            return cb(err);
        else
            client.end("show stat\n");
    });
    client.on('error', function(err)
    {
        error = err;
    });
    client.on('data', function(data)
    {
        response += data.toString();
    });
    client.on('end', function() {
        if (error)
            return cb(error)
        else
            return cb(null, response);
    });
}

function getStatsFromEndpoint(cb)
{
    // call happroxy endpoint to get the stats page
    _request.get(_param.url, _httpOptions, function(err, resp, body)
    {
        if (err)
           return cb(err);
        if (resp.statusCode !== 200)
           return cb(new Error('Haproxy returned with an error - recheck the URL and credentials that you provided'));
        if (!body)
           return cb(new Error('Haproxy statistics return empty'));

       return cb(null, body);
    });
}

function processStats(body, cb)
{
    if (!body)
        return cb(new Error("No data returned from Haproxy"));

    var stats = {};
    var lines = body.split('\n');
    lines.forEach(function(line)
    {
        // skip over empty lines and comments
        if (!line || line[0] === '#')
            return;

        // process the line
        var data = line.split(',');
        var name = data[0];
        var type = data[1];

         // we only care about front end or backend data, we skip the individual servers
        if (type !== 'FRONTEND' && type !== 'BACKEND')
            return;

        // the user can filter the front end or backend data
        if (_filterProxies && !(name in _proxies))
            return;

        // save the data
        stats[name] = {};
        data.forEach(function(value, index)
        {
            var key = _haproxyKeys[index];
            if (value == null || value === '')
            {
                stats[name][key] = null;
                return;
            }

            var intValue = parseInt(value,10);
            if (intValue === 0 || intValue)
                stats[name][key] = intValue;
            else
                stats[name][key] = value.trim();
        });
    });

    return cb(null, stats);
}


// get the stats, format the output and send to stdout
function poll(cb)
{
    _getStats(function(err, stats)
    {
        if (err)
            return console.error(err);

        processStats(stats, function(err, current)
        {
            // if we hit an error, log it and try again
            if (err)
            {
                _previous = null;
                _ts = null;
                console.error(err);
                return setTimeout(poll, _pollInterval);
            }

            // if these are the first stats, skip it so we do not return invalid data
            if (!_previous)
            {
                _previous = current;
                _ts = Date.now();
                return setTimeout(poll, _pollInterval);
            }

            // go through each of the proxies the user cares about
            var delta = (Date.now() - _ts)/1000;
            Object.keys(current).forEach(function(proxy)
            {
                var name = proxy;
                var alias = (_proxies && _proxies[name]) || _source + '-' + proxy;
                var cur = current[name];
                var prev = _previous[name] || {};
                var hasPrev = Object.keys(prev).length !== 0;

                var queueLimit = (cur.qcur && cur.qlimit) ? (cur.qcur/cur.qlimit) : 0.0;
                var sessionLimit = (cur.scur && cur.slim) ? (cur.scur/cur.slim) : 0.0;
                var warnings = diff(cur.wretr + cur.wredis, prev.wretr + prev.wredis) / delta;
                var errors = diff(cur.ereq + cur.econ + cur.eresp, prev.ereq + prev.econ + prev.eresp) / delta;
                var downtime = diff(cur.downtime, prev.downtime) * 1000 / delta;

                console.log('HAPROXY_REQUESTS_QUEUED %d %s', cur.qcur, alias);
                console.log('HAPROXY_REQUESTS_QUEUE_LIMIT %d %s', queueLimit, alias); // this is a percentage

                console.log('HAPROXY_REQUESTS_HANDLED %d %s', diff(cur.req_tot, prev.req_tot, delta), alias);
                console.log('HAPROXY_REQUESTS_ABORTED_BY_CLIENT %d %s', diff(cur.cli_abrt, prev.cli_abrt, delta), alias);
                console.log('HAPROXY_REQUESTS_ABORTED_BY_SERVER %d %s', diff(cur.srv_abrt, prev.srv_abrt, delta), alias);

                console.log('HAPROXY_SESSIONS %d %s', cur.scur, alias);
                console.log('HAPROXY_SESSION_LIMIT %d %s', sessionLimit, alias);  // this is a percentage

                console.log('HAPROXY_BYTES_IN %d %s', diff(cur.bin, prev.bin, delta), alias);
                console.log('HAPROXY_BYTES_OUT %d %s', diff(cur.bout, prev.bout, delta), alias);

                console.log('HAPROXY_WARNINGS %d %s', warnings, alias);
                console.log('HAPROXY_ERRORS %d %s', errors, alias);
                console.log('HAPROXY_FAILED_HEALTH_CHECKS %d %s', diff(cur.chkfail, prev.chkfail, delta), alias);
                console.log('HAPROXY_DOWNTIME_SECONDS %d %s', downtime, alias);

                console.log('HAPROXY_1XX_RESPONSES %d %s', diff(cur.hrsp_1xx, prev.hrsp_1xx, delta), alias);
                console.log('HAPROXY_2XX_RESPONSES %d %s', diff(cur.hrsp_2xx, prev.hrsp_2xx, delta), alias);
                console.log('HAPROXY_3XX_RESPONSES %d %s', diff(cur.hrsp_3xx, prev.hrsp_3xx, delta), alias);
                console.log('HAPROXY_4XX_RESPONSES %d %s', diff(cur.hrsp_4xx, prev.hrsp_4xx, delta), alias);
                console.log('HAPROXY_5XX_RESPONSES %d %s', diff(cur.hrsp_5xx, prev.hrsp_5xx, delta), alias);
                console.log('HAPROXY_OTHER_RESPONSES %d %s', diff(cur.hrsp_other, prev.hrsp_other, delta), alias);
            });

            _previous = current;
            _ts = Date.now();
            setTimeout(poll, _pollInterval);
        });
    });
}
poll();
