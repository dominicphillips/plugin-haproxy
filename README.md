Boundary HAProxy Plugin
-----------------------

Collects statistics from an HAProxy instance. To get statistics from HAProxy instance, you need to instruct HAProxy where to host the statistics. Either a filesocket or webpage can be specified.

### Prerequisites

|     OS    | Linux | Windows | SmartOS | OS X |
|:----------|:-----:|:-------:|:-------:|:----:|
| Supported |   v   |    v    |    v    |  v   |

|  Runtime | lua | Python | Java |
|:---------|:-------:|:------:|:----:|
| Required |    +    |        |      |

- [How to install node.js?](https://help.boundary.com/hc/articles/202360701)

### Plugin Setup

The plugin requires either a file socket or a web page to collect HAProxy statistics. The sections below describe configuration for each.

#### Using a File Socket
The following snippet of configuration will host the statistics on a file socket.
* the `mode` parameter sets the mode of the file socket.  If the relay is running as the same user as haproxy, `mode 777` can be omitted'
* the `level` parameter limits the commands available from the file socket

    global
        stats socket /tmp/haproxy mode 777 level operator

#### Using a Web Page
The following snippet of configuration will tell haproxy to host a webpage the plugin will scrape (you can view the webpage as well)
* `stats enable` tell haproxy to enable the webpage
* `stats uri /stats` tell haproxy to host the webpage at /stats, this needs to be a unique URL not being used in your application.  If your website already has a /stats page, change this values to something else
* `stats auth username:password` tell haproxy to password protect the page with the username and password combination
* `stats refresh 10` tells haproxy to refresh the webpage every 10s if your browser is viewing it

    defaults
        stats enable
        stats uri /stats
        stats auth username:password
        stats refresh 10

Once you make the update, reload your haproxy configuration
	`sudo service haproxy reload`

### Plugin Configuration Fields
|Field Name    |Description                                                                                             |
|:-------------|:-------------------------------------------------------------------------------------------------------|
|Source        |The Source to display in the legend for the haproxy data.  It will default to the hostname of the server|                                      |
|Statistics URL|The URL endpoint of where the haproxy statistics are hosted.  Socket or URL is required                 |
|Username      |If the endpoint is password protected, what username should graphdat use when calling it.               |
|Password      |If the endpoint is password protected, what password should graphdat use when calling it.               |
|Filter        |Which Server groups would you like to view                                                              |
|Poll Seconds  |How often should the plugin poll the Haproxy endpoint                                                   |

### Metrics Collected

Tracks the following metrics for [haproxy](http://www.haproxy.org)

|Metric Name                 |Description                                         |
|:---------------------------|:---------------------------------------------------|
|Haproxy Queued Requests     | current queued requests                            |
|Haproxy Queue Limit         |queue Limit                                         |
|Haproxy Handled Requests    |total number of HTTP requests handled               |
|Haproxy Client Aborts       |number of data transfers aborted by the client      |
|Haproxy Server aborts       |number of data transfers aborted by the server      |
|Haproxy Current Sessions    |current sessions                                    |
|Haproxy Session Limit       |session limit                                       |
|Haproxy Bytes In            |bytes in                                            |
|Haproxy Bytes Out           |bytes out                                           |
|Haproxy Warnings            |retries + redispatched                              |
|Haproxy Errors              |request errors + connection errors + response errors|
|Haproxy Failed Health Checks|the number of failed health checks                  |
|Haproxy Downtime            |the number of seconds haproxy is down               |
|Haproxy 1XX Resp            |The number of 1XX HTTP responses                    |
|Haproxy 2XX Resp            |the number of 2XX HTTP responses                    |
|Haproxy 3XX Resp            |the number of 3XX HTTP responses                    |
|Haproxy 4XX Resp            |the number of 4XX HTTP responses                    |
|Haproxy 5XX Resp            |the  number of 5XX HTTP responses                   |
|Haproxy Other Resp          |http responses with other codes (protocol error)    |
