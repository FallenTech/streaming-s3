# Streaming-S3

[![Build Status](https://travis-ci.org/talha-asad/streaming-s3.png?branch=master)](https://travis-ci.org/talha-asad/streaming-s3)

A simple and light-weight S3 upload streaming module for NodeJS.


## Benefits & Features
* Tons of configurable options
* Low memory usage
* Parallel part uploading
* Simple interface (Asynchronous and evented)
* Downloading and uploading statistics (U/D speed and U/D time)
* Super fast
* Proper usage of streams and graceful error handling
* Production ready (Used and tested on production environments, uploading gigabytes of files to S3)
* Uses official AWS SDK


## Installation

```
$ npm install streaming-s3
```


## Example Usage


### Example 1: Uploading local file with callback.

```js
var Streaming-S3 = require('streaming-s3'),
    fs = require('fs');

var fStream = fs.CreateReadStream(__dirname + '/video.mp4');
var uploader = new Streaming-S3(fStream, 'accessKey', 'secretKey',
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
var Streaming-S3 = require('streaming-s3'),
    fs = require('fs');

var fStream = fs.CreateReadStream(__dirname + '/video.mp4');
var uploader = new Streaming-S3(fStream, 'accessKey', 'secretKey',
  {
    Bucket: 'example.streaming-s3.com',
    Key: 'video.mp4',
    ContentType: 'video/mp4'
  }
);
  
uploader.begin(); // important if callback not provided.

uploader.on('data', function (e, bytesRead) {
  console.log(bytesRead, ' bytes read.');
});

uploader.on('partUploaded', function (e, partNumber) {
  console.log(partNumber, ' part uploaded.');
});

// All parts uploaded, but upload not yet acknowledged.
uploader.on('uploaded', function (e, stats) {
  console.log('Upload stats: ', stats);
});

uploader.on('finished', function (e, resp, stats) {
  console.log('Upload finished: ', resp);
});

uploader.on('error', function (e) {
  console.log('Upload error: ', e);
});
```


### Example 3