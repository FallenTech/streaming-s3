# Streaming-S3

[![Build Status](https://travis-ci.org/FallenTech/streaming-s3.png?branch=master)](https://travis-ci.org/FallenTech/streaming-s3)
[![Dependency Status](https://www.versioneye.com/user/projects/59c83eee2de28c00382c935a/badge.svg)](https://www.versioneye.com/user/projects/59c83eee2de28c00382c935a)
[![NPM version](https://badge.fury.io/js/streaming-s3.svg)](http://badge.fury.io/js/streaming-s3)

[![NPM stats](https://nodei.co/npm/streaming-s3.png?downloads=true)](https://www.npmjs.org/package/streaming-s3)

A simple and light-weight S3 upload streaming module for NodeJS.


## Benefits & Features
* Super fast and super easy to use
* Low memory usage
* Nothing is written to disk during upload
* Parallel part uploading
* No need to know total size of the object
* Implicit retry mechanism for failed part uploads
* Tons of configurable options
* Simple interface (Asynchronous and evented)
* Downloading and uploading statistics (U/D speed and U/D time)
* Proper usage of streams and graceful error handling
* Production ready (Used and tested on production environments, uploading gigabytes of files to S3)
* Uses official AWS SDK


## Installation

```
$ npm install streaming-s3
```


## Version 0.4 and 0.3.x Changes
Starting from version 0.4 onwards you can pass in an object that is used to configure the underlying aws-sdk. This can contain **region** and other parameters.

* Old Constructor (Still supported)
```js
var uploader = new streamingS3(fStream, 'accessKey', 'secretKey', ...
```

* New Constructor
```js
var uploader = new streamingS3(fStream, {accessKeyId: 'accessKey', secretAccessKey: 'secretKey'}, ...
```


## Example Usage


### Example 1: Uploading local file with callback.

```js
var streamingS3 = require('streaming-s3'),
    fs = require('fs');

var fStream = fs.createReadStream(__dirname + '/video.mp4');
var uploader = new streamingS3(fStream, {accessKeyId: 'accessKey', secretAccessKey: 'secretKey'},
  {
    Bucket: 'example.streaming-s3.com',
    Key: 'video.mp4',
    ContentType: 'video/mp4'
  },  function (e, resp, stats) {
  if (e) return console.log('Upload error: ', e);
  console.log('Upload stats: ', stats);
  console.log('Upload successful: ', resp);
  }
);
```

### Example 2: Uploading local file without callback.

```js
var streamingS3 = require('streaming-s3'),
    fs = require('fs');

var fStream = fs.createReadStream(__dirname + '/video.mp4');
var uploader = new streamingS3(fStream, {accessKeyId: 'accessKey', secretAccessKey: 'secretKey'},
  {
    Bucket: 'example.streaming-s3.com',
    Key: 'video.mp4',
    ContentType: 'video/mp4'
  }
);

uploader.on('data', function(bytesRead) {
  console.log(bytesRead, ' bytes read.');
});

uploader.on('part', function(number) {
  console.log('Part ', number, ' uploaded.');
});

// All parts uploaded, but upload not yet acknowledged.
uploader.on('uploaded', function(stats) {
  console.log('Upload stats: ', stats);
});

uploader.on('finished', function(resp, stats) {
  console.log('Upload finished: ', resp);
});

uploader.on('error', function(e) {
  console.log('Upload error: ', e);
});

uploader.begin(); // important if callback not provided.
```


### Example 3: Uploading remote file without callback and options

```js
var streamingS3 = require('streaming-s3'),
    request = require('request');

var rStream = request.get('http://www.google.com');
var uploader = new streamingS3(rStream, {accessKeyId: 'accessKey', secretAccessKey: 'secretKey'},
  {
    Bucket: 'example.streaming-s3.com',
    Key: 'google.html',
    ContentType: 'text/html'
  },
  {
    concurrentParts: 2,
    waitTime: 10000,
    retries: 1,
    maxPartSize: 10 * 1024 * 1024
  }
);

uploader.on('data', function(bytesRead) {
  console.log(bytesRead, ' bytes read.');
});

uploader.on('part', function(number) {
  console.log('Part ', number, ' uploaded.');
});

// All parts uploaded, but upload not yet acknowledged.
uploader.on('uploaded', function(stats) {
  console.log('Upload stats: ', stats);
});

uploader.on('finished', function(resp, stats) {
  console.log('Upload finished: ', resp);
});

uploader.on('error', function(e) {
  console.log('Upload error: ', e);
});

uploader.begin(); // important if callback not provided.
```

## Defaults and Configurables

* **concurrentParts** (Default: 5) - Parts that are uploaded simultaneously.
* **waitTime** (Default: 1 Min) - Time to wait for acknowledgement from S3 after uploading a part in ms, use 0 for forever.
* **retries** (Default: 5) - Number of times to retry uploading a part, before failing.
* **maxPartSize** (Default: 5 MB) - Maximum size of each part in bytes.


## Statistics object

* **downloadTime** - Download time in seconds. (Reading from stream)
* **downloadSpeed** - Download speed in bytes/second.
* **uploadTime** - Upload time in seconds.
* **uploadSpeed** - Upload speed in bytes/second. (Streaming to S3)
* **size** - Total bytes uploaded.


## License

The MIT License (MIT)

Copyright (c) 2014 - 2017 Talha Asad

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.