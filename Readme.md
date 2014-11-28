# Streaming-S3

[![Build Status](https://travis-ci.org/mindblaze/streaming-s3.png?branch=master)](https://travis-ci.org/mindblaze/streaming-s3)
[![Dependency Status](https://www.versioneye.com/user/projects/5445ece1e5a8f0ccb2000005/badge.svg)](https://www.versioneye.com/user/projects/5445ece1e5a8f0ccb2000005)
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
Starting from version 0.4 onwards you can pass in an object that is used to configure the underlying the aws-sdk. This can contain **region** and other parameters.

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

var fStream = fs.CreateReadStream(__dirname + '/video.mp4');
var uploader = new streamingS3(fStream, {accessKeyId: 'accessKey', secretAccessKey: 'secretKey'},
  {
    Bucket: 'example.streaming-s3.com',
    Key: 'video.mp4',
    ContentType: 'video/mp4'
  },  function (err, resp, stats) {
  if (err) return console.log('Upload error: ', e);
  console.log('Upload stats: ', stats);
  console.log('Upload successful: ', resp);
  }
);
```

### Example 2: Uploading local file without callback.

```js
var streamingS3 = require('streaming-s3'),
    fs = require('fs');

var fStream = fs.CreateReadStream(__dirname + '/video.mp4');
var uploader = new streamingS3(fStream, {accessKeyId: 'accessKey', secretAccessKey: 'secretKey'},
  {
    Bucket: 'example.streaming-s3.com',
    Key: 'video.mp4',
    ContentType: 'video/mp4'
  }
);
  
uploader.begin(); // important if callback not provided.

uploader.on('data', function (bytesRead) {
  console.log(bytesRead, ' bytes read.');
});

uploader.on('part', function (number) {
  console.log('Part ', number, ' uploaded.');
});

// All parts uploaded, but upload not yet acknowledged.
uploader.on('uploaded', function (stats) {
  console.log('Upload stats: ', stats);
});

uploader.on('finished', function (resp, stats) {
  console.log('Upload finished: ', resp);
});

uploader.on('error', function (e) {
  console.log('Upload error: ', e);
});
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
    maxPartSize: 10*1024*1024,
  }
);
  
uploader.begin(); // important if callback not provided.

uploader.on('data', function (bytesRead) {
  console.log(bytesRead, ' bytes read.');
});

uploader.on('part', function (number) {
  console.log('Part ', number, ' uploaded.');
});

// All parts uploaded, but upload not yet acknowledged.
uploader.on('uploaded', function (stats) {
  console.log('Upload stats: ', stats);
});

uploader.on('finished', function (resp, stats) {
  console.log('Upload finished: ', resp);
});

uploader.on('error', function (e) {
  console.log('Upload error: ', e);
});
```

## Defaults and Configurables

* **concurrentParts** (Default: 5) - Parts that are uploaded simultaneously.
* **waitTime** (Default: 1 min (60000 ms)) - Time to wait for verification from S3 after uploading parts.
* **retries** (Default: 5) - Number of times to retry uploading a part, before failing.
* **maxPartSize** (Default: 5 MB) - Maximum size of each part.


## Statistics object

* **downloadTime** - Download time in seconds. (Reading from stream)
* **downloadSpeed** - Download speed in bytes/second.
* **uploadTime** - Upload time in seconds.
* **uploadSpeed** - Upload speed in bytes/second. (Streaming to S3)
* **size** - Total bytes uploaded.


## History

* v0.4.0 (2014-11-28) -- New constructor signature, added option to specify region and updated dependencies.
* v0.3.4 (2014-10-10) -- Fixed dependencies badge.
* v0.3.3 (2014-10-10) -- Upgraded AWS SDK to latest stable version (2.0.21).
* v0.3.2 (2014-06-09) -- Fixed Readme and version bump, to remove confusion.
* v0.3.1-1 (2014-06-01) -- Updated dependencies.
* v0.3.1 (2014-06-01) -- Fixed stats object.
* v0.3.0 (2014-05-08) -- Downgraded AWS SDK to stable version (1.18)
* v0.2.9 (2014-05-07) -- some minor improvements.
* v0.2.8 (2014-04-07) -- added size property to stats object.
* v0.2.7 (2014-03-27) -- Critical interval issues addressed.
* v0.2.6 (2014-03-27) -- Various minor improvements.
* v0.2.4 (2014-03-26) -- Various minor improvements.
* v0.2.3 (2014-03-24) -- Options overwriting bug resolved.
* v0.2.2 (2014-03-24) -- Added some useful keywords to the package.
* v0.2.1 (2014-03-24) -- Prevent callback being fired twice in case of failure.
* v0.2.0 (2014-03-22) -- Updated dependencies.
* v0.1.9 (2014-03-21) -- acknowledgement logic improved.
* v0.1.8 (2014-03-21) -- Closes #1 and lots of fixes.
* v0.1.7 (2014-03-15) -- Initial release.


## License

The MIT License (MIT)

Copyright (c) 2014 Talha Asad

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