local JSON     = require('json')
local timer    = require('timer')
local http     = require('http')
local https    = require('https')
local boundary = require('boundary')
local io       = require('io')
local os       = require('os')
local _url     = require('_url')
local base64   = require('luvit-base64')


local __pgk        = "BOUNDARY HAPROXY"
local _previous    = {}
local _proxies     = {}
local url          = "http://localhost/stats;csv"
local pollInterval = 1000
local source, username, password, _ts
local _haproxyKeys = {
    'pxname',           -- proxy name (ex. http-in)
    'svname',           -- service name (FRONTEND or BACKEND_
    'qcur',             -- current queued requests (ex 0)
    'qmax',             -- max queued requests (ex 0)
    'scur',             -- current sessions (ex. 13)
    'smax',             -- max sessions (ex. 35)
    'slim',             -- session limit (ex. 2000)
    'stot',             -- total sessions (ex. 11151)
    'bin',              -- bytes in (ex. 1622452007)
    'bout',             -- bytes out (ex. 612088528)
    'dreq',             -- denied requests (ex. 0 )
    'dresp',            -- denied responses (ex. 0)
    'ereq',             -- request errors (ex. 84)
    'econ',             -- connections errors (ex. 0)
    'eresp',            -- response errors like srv_abrt (ex. 0)
    'wretr',            -- retries (warning)
    'wredis',           -- redispatched (warning)
    'status',           -- status (UP/DOWN/NOLB/MAINT/OPEN/CLOSED)
    'weight',           -- weighting of the server, or total weight of the backend (ex 1)
    'act',              -- server is active (server), number of active servers (backend) (ex. Y)
    'bck',              -- server is backup (server), number of backup servers (backend)
    'chkfail',          -- number of failed health checks (ex. 0)
    'chkdown',          -- number of Up/Down transitions (ex. 0)
    'lastchg',          -- how many seconds since the last time the status changed (ex. 523098)
    'downtime',         -- total seconds of down time (ex. 65433)
    'qlimit',           -- queue limit (ex. 0)
    'pid',              -- process Id, 0 for first instance, 1 for second (ex. 1)
    'iid',              -- unique proxy id (ex. 7)
    'sid',              -- service id (unique within a proxy) (ex. 0)
    'throttle',         -- warm up status
    'lbtot',            -- total number of times a server was selected
    'tracked',          -- id of proxy/server is tracking is enabled
    'type',             -- type (0=frontend, 1=backend, 2=server, 3=socked)
    'rate',             -- number of sessions per second over last elapsed second
    'rate_lim',         -- limit on new sesions per second
    'rate_max',         -- max number of new sessions per second
    'check_status',     -- status of last health check
    'check_code',       -- layer5-7 code if available
    'check_duration',   -- time in ms to finish the last health check
    'hrsp_1xx',         -- http responses with 1xx codes
    'hrsp_2xx',         -- http responses with 2xx codes
    'hrsp_3xx',         -- http responses with 3xx codes
    'hrsp_4xx',         -- http responses with 4xx codes
    'hrsp_5xx',         -- http responses with 5xx codes
    'hrsp_other',       -- http responses with other codes (protocol error)
    'hanafail',         -- failed health check details
    'req_rate',         -- HTTP request per second over last elapsed second
    'req_rate_max',     -- max number of HTTP requests per second observerd
    'req_tot',          -- total number of HTTP requests received
    'cli_abrt',         -- number of data transfers aborted by the client
    'srv_abrt'          -- number of data transfers aborted by the server
}

function split(str, delimiter)
    if (delimiter=='') then return false end
    local pos,array = 0, {}
    -- for each divider found
    for st,sp in function() return string.find(str, delimiter, pos, true) end do
        table.insert(array, string.sub(str, pos, st - 1))
        pos = sp + 1
    end
    table.insert(array, string.sub(str, pos))
    return array
end

local function isempty(s)
  return s == nil or s == ''
end

function trim(s)
  if isempty(s) then return nil end
  return (s:gsub("^%s*(.-)%s*$", "%1"))
end

if (boundary.param ~= nil) then
  pollInterval       = boundary.param.pollInterval or pollInterval
  url                = (boundary.param.url or url) .. ";csv"
  username           = boundary.param.username
  password           = boundary.param.password
  source             = (type(boundary.param.source) == 'string' and boundary.param.source:gsub('%s+', '') ~= '' and boundary.param.source) or
   io.popen("uname -n"):read('*line')

  if not boundary.param.proxies == nil then
    for i, proxy in ipairs(boundary.param.proxies) do
      local values = split(proxy, ",")
      _proxies[values[1] or proxy] = source .. '-' .. (values[2] or proxy)
    end
  end
end


function berror(err)
  if err then print(string.format("%s ERROR: %s", __pgk, tostring(err))) return err end
end

--- do a http(s) request
local doreq = function(url, cb)
    local u = _url.parse(url)
    u.protocol = u.scheme
    -- reject self signed certs
    u.rejectUnauthorized = strictSSL
    if username and password then
      u.headers = {Authorization = "Basic " .. (base64.encode(username..":"..password))}
    end
    local output = ""
    local onSuccess = function(res)
      res:on("error", function(err)
        cb("Error while receiving a response: " .. tostring(err), nil)
      end)
      res:on("data", function (chunk)
        output = output .. chunk
      end)
      res:on("end", function()
        if res.statusCode == 401 then return cb("Authentication required, provide user and password", nil) end
        res:destroy()
        cb(nil, output)
      end)
    end
    local req = (u.scheme == "https") and https.request(u, onSuccess) or http.request(u, onSuccess)
    req:on("error", function(err)
      cb("Error while sending a request: " .. tostring(err), nil)
    end)
    req:done()
end

function charat (str, index)
  return string.sub(str, index + 1, index + 1)
end

function parseStats(body)
    local stats = {}
    for _, v in ipairs(split(body, "\n")) do
      if v and not (charat(v, 0) == "#") then
        local data = split(v, ",")
        local _name = data[1]
        local _type = data[2]
        if _type == 'FRONTEND' or _type == 'BACKEND' then
          stats[_name] = {}
          for i, val in ipairs(data) do
            local k = _haproxyKeys[i]
            local v = tonumber(val) or trim(val) or 0
            if k then
              stats[_name][k] = v
            end
          end
        end
      end
    end
    return stats
end


-- get the natural difference between a and b
function diff(a, b, delta)
  if not a or not b or not delta then return 0 end
  return math.max(a - b, 0) / delta
end

function table.empty (self)
    for _, _ in pairs(self) do
        return false
    end
    return true
end

function printStats(current)

    if table.empty(_previous) then
      _previous = current
      _ts = os.time()
      return
    end

    local delta = (os.time() - _ts) / 1000
    for k, v in pairs(current) do

      local name         = k
      local alias        = (_proxies and _proxies[name]) or (source .. '-' .. name)
      local cur          = current[name]
      local prev         = _previous[name] or {}
      local queueLimit   = (cur.qcur and not cur.qlimit == "") and (cur.qcur/cur.qlimit) or 0.0
      local sessionLimit = (cur.scur and cur.slim) and (cur.scur/cur.slim) or 0.0
      local warnings     = diff(cur.wretr + cur.wredis, prev.wretr + prev.wredis) / delta
      local errors       = diff(cur.ereq + cur.econ + cur.eresp, prev.ereq + prev.econ + prev.eresp) / delta
      local downtime     = diff(cur.downtime, prev.downtime) * 1000 / delta

      print(string.format('HAPROXY_REQUESTS_QUEUED %d %s', cur.qcur, alias))
      print(string.format('HAPROXY_REQUESTS_QUEUE_LIMIT %d %s', queueLimit, alias)) -- this is a percentage

      print(string.format('HAPROXY_REQUESTS_HANDLED %d %s', diff(cur.req_tot, prev.req_tot, delta), alias))
      print(string.format('HAPROXY_REQUESTS_ABORTED_BY_CLIENT %d %s', diff(cur.cli_abrt, prev.cli_abrt, delta), alias))
      print(string.format('HAPROXY_REQUESTS_ABORTED_BY_SERVER %d %s', diff(cur.srv_abrt, prev.srv_abrt, delta), alias))

      print(string.format('HAPROXY_SESSIONS %d %s', cur.scur, alias))
      print(string.format('HAPROXY_SESSION_LIMIT %d %s', sessionLimit, alias))  -- this is a percentage

      print(string.format('HAPROXY_BYTES_IN %d %s', diff(cur.bin, prev.bin, delta), alias))
      print(string.format('HAPROXY_BYTES_OUT %d %s', diff(cur.bout, prev.bout, delta), alias))

      print(string.format('HAPROXY_WARNINGS %d %s', warnings, alias))
      print(string.format('HAPROXY_ERRORS %d %s', errors, alias))
      print(string.format('HAPROXY_FAILED_HEALTH_CHECKS %d %s', diff(cur.chkfail, prev.chkfail, delta), alias))
      print(string.format('HAPROXY_DOWNTIME_SECONDS %d %s', downtime, alias))

      print(string.format('HAPROXY_1XX_RESPONSES %d %s', diff(cur.hrsp_1xx, prev.hrsp_1xx, delta), alias))
      print(string.format('HAPROXY_2XX_RESPONSES %d %s', diff(cur.hrsp_2xx, prev.hrsp_2xx, delta), alias))
      print(string.format('HAPROXY_3XX_RESPONSES %d %s', diff(cur.hrsp_3xx, prev.hrsp_3xx, delta), alias))
      print(string.format('HAPROXY_4XX_RESPONSES %d %s', diff(cur.hrsp_4xx, prev.hrsp_4xx, delta), alias))
      print(string.format('HAPROXY_5XX_RESPONSES %d %s', diff(cur.hrsp_5xx, prev.hrsp_5xx, delta), alias))
      print(string.format('HAPROXY_OTHER_RESPONSES %d %s', diff(cur.hrsp_other, prev.hrsp_other, delta), alias))
    end
    _previous = current

end

print("_bevent:HAPROXY plugin up : version 1.0|t:info|tags:haproxy,lua, plugin")

timer.setInterval(pollInterval, function ()

  doreq(url, function(err, body)
      if berror(err) then return end
      printStats(parseStats(body))

  end)

end)




