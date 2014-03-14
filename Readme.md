# Streaming-S3

[![Build Status](https://travis-ci.org/talha-asad/streaming-s3.png?branch=master)](https://travis-ci.org/talha-asad/streaming-s3)

A simple and light-weight S3 upload streaming module for NodeJS.

## Features
* Concurrent part uploading
* Uses official AWS SDK
* Simple interface
* Highly robust
* Impressively fast
* Good usage of streams and error handling
* Production ready (Used and tested on production environments, uploading gigabytes of files to S3)

## Installation

```
$ npm install streaming-s3
```

## Example Usage

### Example 1: Uploading local file with callback.

```js
var Streaming-S3 = require('streaming-s3'),
    fs = require('fs');

var fileStream = fs.CreateReadStream(__dirname + '/video.mp4');
var uploader = new Streaming-S3(fileStream, 'ACCESS_KEY', 'SECRET_KEY', {Bucket: 'example.streaming-s3.com', Key: 'video.mp4', ContentType: 'video/mp4'}, function (err, resp) {
  if (err) return console.log('Upload failed cause: ', e);
  console.log('Upload successful: ', resp);
});
```

### Example 2: Uploading local file without callback.

```js
var Streaming-S3 = require('streaming-s3'),
    fs = require('fs');

var fileStream = fs.CreateReadStream(__dirname + '/video.mp4');
var uploader = new Streaming-S3(fileStream, 'ACCESS_KEY', 'SECRET_KEY', {Bucket: 'example.streaming-s3.com', Key: 'video.mp4', ContentType: 'video/mp4'});
uploader.begin(); // important if callback not provided.

uploader.on('data', function (e, bytesRead) {
  console.log(bytesRead, ' bytes read');
});

uploader.on('partUploaded', function (e, partNumber) {
  console.log(partNumber, ' part uploaded');
});

uploader.on('finished', function (e, resp) {
  console.log('upload finished: ', resp);
});

uploader.on('error', function (e) {
  console.log('uploaded error: ', e);
});
```

### Example 3