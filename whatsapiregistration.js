var util        = require('util');
var events      = require('events');
var fs          = require('fs');
var crypto      = require('crypto');
var url         = require('url');
var http        = require('http');
var https       = require('https');
var querystring = require('querystring');
var common      = require('./common');
var encryption  = require('./encryption');


/**
* @class WhatsApiRegistration
* @param {WhatsApiRegistationConfig} config
*/
function WhatsApiRegistration(config) {
	this.config = common.extend({}, this.defaultConfig, config);
	
	events.EventEmitter.call(this);
}

util.inherits(WhatsApiRegistration, events.EventEmitter);

WhatsApiRegistration.prototype.defaultConfig = {
	msisdn     : '',
	device_id  : '',
	ccode      : '',
	ua         : 'WhatsApp/2.11.69 Android/4.3 Device/GalaxyS3',
	language   : 'uz',
	country    : 'UZ',
	magic_file : __dirname + '/magic'
};

WhatsApiRegistration.prototype.checkCredentials = function() {
	this.request('exist', {c : 'cookie'}, function(response, source) {
		if(response.status !== 'fail') {
			this.emit('error', 'Invalid response status: ' + source);
			return;
		}
		
		switch(response.reason) {
			case 'blocked':
				this.emit('credentials.blocked', this.config.msisdn);
				break;
			case 'incorrect':
				this.emit('credentials.notfound', this.config.msisdn);
				break;
			case 'bad_param':
				this.emit('error', 'bad params: ' + source);
				break;
			case 'format_wrong':
				this.emit('error', 'msisdn cannot be used');
				break;
			case 'missing_param':
				this.emit('error', 'missing param: ' + source);
				break;
			default:
				this.emit('error', 'Credentials check fail with unexpected reason: ' + source);
		}
	}.bind(this));
};

WhatsApiRegistration.prototype.requestCode = function() {
	var match = this.config.msisdn.match(/^998(\d+)$/);
	
	if(!match) {
		this.emit('error', 'Invalid msisdn provided');
	}
	
	var token = this.generateToken('Uzbekistan', match[1]);
	
	var params = {
		to     : this.config.msisdn,
		lg     : this.config.language,
		lc     : this.config.country,
		method : 'sms',
		mcc    : this.config.ccode,
		mnc    : '001',
		token  : token
	};
	
	this.request('code', params, function(response, source) {
		if(response.status === 'sent') {
			this.emit('code.sent', this.config.msisdn);
			return;
		}
		
		if(response.reason === 'too_recent') {
			this.emit('code.wait', this.config.msisdn, response.retry_after);
			return;
		}
		
		this.emit('error', 'Code request error: ' + source);
	}.bind(this));
};
	
WhatsApiRegistration.prototype.registerCode = function(code) {
	var params = {
		c    : 'cookie',
		code : code
	};
	
	this.request('register', params, function(response, source) {
		this.emit('error', 'Code registration failed: ' + source);
	});
};
	
WhatsApiRegistration.prototype.request = function(method, queryParams, callback) {
	var match = this.config.msisdn.match(/^998(\d+)$/);
	
	if(!match) {
		this.emit('error', 'Invalid msisdn provided');
	}
	
	var query = {
		cc : '998',
		in : match[1],
		id : querystring.unescape(this.config.device_id)
	};
	
	if(queryParams instanceof Function) {
		callback = queryParams;
	} else {
		common.extend(query, queryParams);
	}
	
	var url = {
		hostname : 'v.whatsapp.net',
		path     : '/v2/' + method + '?' + querystring.stringify(query),
		headers  : {
			'User-Agent' : this.config.ua,
			'Accept'     : 'text/json'
		}
	};
	
	var req = https.get(url, function(res) {
		var buffers = [];
		
		res.on('data', function(buf) {
			buffers.push(buf);
		});
		
		res.on('end', function() {
			var jsonbody = Buffer.concat(buffers).toString();
			
			try {
				var response = JSON.parse(jsonbody);
			} catch(e) {
				this.emit('error', 'Non-json response: ' + response);
				return;
			}
			
			if(response.status !== 'ok') {
				callback(response, jsonbody);
				return;
			}
			
			this.emit('success',
				this.config.msisdn,
				response.login,
				response.pw,
				response.type,
				response.expiration,
				response.kind,
				response.price,
				response.cost,
				response.currency,
				response.price_expiration
				);
		}.bind(this));
	}.bind(this));

	req.on('error', function(e) {
		this.emit('error', e);
	}.bind(this));
};

WhatsApiRegistration.prototype.generateToken = function(country, msisdn) {
	var magicxor  = new Buffer('The piano has been drinkin', 'utf8');
	var magicfile = fs.readFileSync(this.config.magic_file);
	
	for(var i = 0, idx = 0; i < magicfile.length; i++, idx++) {
		if(idx === magicxor.length) {
			idx = 0;
		}
		
		magicfile[i] = magicfile[i] ^ magicxor[idx];
	}
	
	var password = Buffer.concat([
		new Buffer('Y29tLndoYXRzYXBw', 'base64'),
		magicfile
		]);
		
	var salt = new Buffer('PkTwKSZqUfAUyR0rPQ8hYJ0wNsQQ3dW1+3SCnyTXIfEAxxS75FwkDf47wNv/c8pP3p0GXKR6OOQmhyERwx74fw1RYSU10I4r1gyBVDbRJ40pidjM41G1I1oN', 'base64');
	
	var key = encryption.pbkdf2(password, salt, 128, 80);
	
	var padlen = 64;
	
	var opad = new Buffer(padlen);
	var ipad = new Buffer(padlen);
	
	for(var i = 0; i < padlen; i++) {
		opad[i] = 0x5C ^ key[i];
		ipad[i] = 0x36 ^ key[i];
	}
	
	var ipadHash = crypto.createHash('sha1');
	
	var data = Buffer.concat([
		new Buffer('MIIDMjCCAvCgAwIBAgIETCU2pDALBgcqhkjOOAQDBQAwfDELMAkGA1UEBhMCVVMxEzARBgNVBAgTCkNhbGlmb3JuaWExFDASBgNVBAcTC1NhbnRhIENsYXJhMRYwFAYDVQQKEw1XaGF0c0FwcCBJbmMuMRQwEgYDVQQLEwtFbmdpbmVlcmluZzEUMBIGA1UEAxMLQnJpYW4gQWN0b24wHhcNMTAwNjI1MjMwNzE2WhcNNDQwMjE1MjMwNzE2WjB8MQswCQYDVQQGEwJVUzETMBEGA1UECBMKQ2FsaWZvcm5pYTEUMBIGA1UEBxMLU2FudGEgQ2xhcmExFjAUBgNVBAoTDVdoYXRzQXBwIEluYy4xFDASBgNVBAsTC0VuZ2luZWVyaW5nMRQwEgYDVQQDEwtCcmlhbiBBY3RvbjCCAbgwggEsBgcqhkjOOAQBMIIBHwKBgQD9f1OBHXUSKVLfSpwu7OTn9hG3UjzvRADDHj+AtlEmaUVdQCJR+1k9jVj6v8X1ujD2y5tVbNeBO4AdNG/yZmC3a5lQpaSfn+gEexAiwk+7qdf+t8Yb+DtX58aophUPBPuD9tPFHsMCNVQTWhaRMvZ1864rYdcq7/IiAxmd0UgBxwIVAJdgUI8VIwvMspK5gqLrhAvwWBz1AoGBAPfhoIXWmz3ey7yrXDa4V7l5lK+7+jrqgvlXTAs9B4JnUVlXjrrUWU/mcQcQgYC0SRZxI+hMKBYTt88JMozIpuE8FnqLVHyNKOCjrh4rs6Z1kW6jfwv6ITVi8ftiegEkO8yk8b6oUZCJqIPf4VrlnwaSi2ZegHtVJWQBTDv+z0kqA4GFAAKBgQDRGYtLgWh7zyRtQainJfCpiaUbzjJuhMgo4fVWZIvXHaSHBU1t5w//S0lDK2hiqkj8KpMWGywVov9eZxZy37V26dEqr/c2m5qZ0E+ynSu7sqUD7kGx/zeIcGT0H+KAVgkGNQCo5Uc0koLRWYHNtYoIvt5R3X6YZylbPftF/8ayWTALBgcqhkjOOAQDBQADLwAwLAIUAKYCp0d6z4QQdyN74JDfQ2WCyi8CFDUM4CaNB+ceVXdKtOrNTQcc0e+t', 'base64'),
		new Buffer('30CnAF22oY+2PUD5pcJGqw==', 'base64'),
		new Buffer(msisdn)
		]);
		
	ipadHash.update(ipad);
	ipadHash.update(data);
	
	var output = crypto.createHash('sha1');
	
	output.update(opad);
	output.update(ipadHash.digest());
	
	return output.digest('base64');
};

exports.WhatsApiRegistration = WhatsApiRegistration;