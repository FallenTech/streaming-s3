var EventEmitter = require('events').EventEmitter,
    util = require('util'),
    async = require('async'),
    aws = require('aws-sdk');


function extendObj (a, b) {
  for (var x in b) a[x] = b[x]
  return a;
}
 
function StreamingS3(stream, s3AccessKey, s3SecretKey, s3Params, options, cb) {
  if (typeof options == 'function') {
    options = {};
    cb = options;
  }
  
  var defaultOptions = {
     concurrentParts: 5,        // Concurrent parts that will be uploaded to s3 (if read stream is fast enough)
     waitTime: 10000,            // In seconds (Only applies once all parts are uploaded), 0 = Unlimited
     retries: 5,                // Number of times to retry a part.
     maxPartSize: 5*1024*1024,  // In bytes, will also consume this much buffering memory.
     timeout: 0,                // In seconds, 0 = Unlimited
  }
  
  options = extendObj(defaultOptions, options);
  this.options = options;
  
  this.stream = stream;
  
  // States
  this.waiting = false;
  this.initiated = false;
  this.failed = false;
  this.reading = false;
  this.finished = false;
  
  // Chunking and buffering
  this.buffer = new Buffer(0);
  this.chunks = [];
  this.chunkNumber = 0;
  this.totalChunks = 0;
  this.uploadedChunks = []; // We just store ETags of all parts, not the actual buffer.
  
  // S3 Parameters and properties
  aws.config.update({accessKeyId: s3AccessKey, secretAccessKey: s3SecretKey, region: s3Params.region? s3Params.region : 'us-west-1'});
  this.s3Client = this.getNewS3Client();
  this.s3Params = s3Params;
  this.s3AccessKey = s3AccessKey;
  this.s3SecretKey = s3SecretKey;
  this.uploadId = null;
  this.cb = cb;
  
  // Timers
  this.waitingTimer = false;
  
  var self = this;
  
  this.on('error', function (e) {
    self.waitingTimer && clearTimeout(self.waitingTimer);
    self.reading = false;
    self.waiting = false;
    self.failed = true;
    
    // Remove our event handlers if any.
    if (self.stream) {
      self.streamErrorHandler && self.stream.removeListener('error', self.streamErrorHandler);
      self.streamDataHandler && self.stream.removeListener('data', self.streamDataHandler);
      self.streamEndHandler && self.stream.removeListener('end', self.streamEndHandler);
    }
    
    if (self.uploadId) {
      var abortMultipartUploadParams = extendObj({UploadId: self.uploadId}, self.options.s3Params);
      self.s3Client.abortMultipartUpload(abortMultipartUploadParams, function (err, data) {
        if (err) cb && cb(err); // We can't do anything if aborting fails :'(
        self.cb && self.cb(e);
      })
    } else self.cb && self.cb(e);
    
  });
  
  // Pause the stream until we hook our events.
  if (stream) stream.pause();
  else this.emit('error', new Error('You must provide a readable stream.'));
  
  // if callback provided then begin, else wait for call to begin.
  cb && this.begin();
}

util.inherits(StreamingS3, EventEmitter);

StreamingS3.prototype.getNewS3Client = function() {
  return (new aws.S3());
}

StreamingS3.prototype.begin = function() {
  if (this.cb) return; // Ignore calls if user has provided callback.
  var self = this;
  
  this.s3Client.createMultipartUpload(this.s3Params, function (err, data) {
    if (err) return self.emit('error', err);
    
    // Assert UploadId presence.
    if (!data.UploadId) return next(new Error('AWS SDK returned invalid object! Expecting UploadId.'));
  
    self.uploadId = data.UploadId;
  });
  
  this.streamErrorHandler = function (err) {
    self.emit('error', err);
  }
  
  this.streamDataHandler = function (chunk) {
    self.reading = true;
    if (typeof chunk === 'string') chunk = new Buffer(chunk, 'utf-8');
    self.buffer = Buffer.concat(self.buffer, chunk);
    if (self.buffer.length >= self.options.maxPartSize) {
      var newChunk;
      if (self.buffer.length > self.options.maxPartSize) {
        newChunk = self.buffer.slice(0, self.options.maxPartSize);
        self.buffer = new Buffer(self.buffer.slize(self.options.maxPartSize));
      } else {
        newChunk = self.buffer.slice(0, self.options.maxPartSize);
        self.buffer = new Buffer(0);
      }
      
      // Add useful properties to each chunk.
      newChunk.finished = false;
      newChunk.number = ++self.totalChunks;
      newChunk.retries = 0;
      self.chunks.push(newChunk);
      self.sendToS3();
      
    }
  }
  
  this.streamEndHandler = function () {
    self.reading = false;
    self.finish();
  }
  
  this.stream.on('error', this.streamErrorHandler);
  this.stream.on('data', this.streamDataHandler);
  this.stream.on('end', this.streamEndHandler);
  this.stream.resume();
  
}

StreamingS3.prototype.sendToS3 = function() {
  var self = this;
  
  this.uploadChunk = function (chunk, next) {
    if (self.failed) return next();
    else if (!chunk.number) return next();
    
    chunk.client = chunk.client ? chunk.client : self.getNewS3Client();
    
    var partS3Params = {
      UploadId: self.uploadId,
      PartNumber: chunk.number,
      Body: chunk
    }
    
    partS3Params = extendObj(self.s3Params, partS3Params);
    
    chunk.client.uploadPart(partS3Params, function (err, data) {
      if (err) {
        if (err.code == 'RequestTimeout') {
          if (chunk.retries >= self.options.retries) return next(err);
          else {
            chunk.retries++;
            return self.uploadChunk(chunk, next);
          }
        } else return next(err);
      }
      
      // Assert ETag presence.
      if (!data.ETag) return next(new Error('AWS SDK returned invalid object when part uploaded! Expecting Etag.'));
      self.uploadedChunks[chunk.number] = data.ETag;
      chunk.finished = true;
      
      // Remove finished chunks, save memory :)
      self.chunks = self.chunks.filter(function (chunk) {
        return chunk.finished !== true;
      });
      
      next();
    });
    
  }
  
  if (this.chunks.length) {
    async.eachLimit(this.chunks, this.uploadChunk, function (err) {
      if (self.failed) return;
      if (err) return self.emit('error', err);
      self.waiting = true;
      self.finish();
    });
  }
  
}

StreamingS3.prototype.finish = function() {
  var self = this;
  
  if (this.failed) return;
  else if (!this.uploadId) return this.emit('error', new Error('No AWS S3 Upload ID set, make sure you provide callback or call init on the object.'));
  
  var listPartsParams = extendObj({UploadId: this.uploadId, MaxParts: this.totalChunks}, this.s3Params);
  this.s3Client.listParts(listPartsParams, function (err, data) {
    if (err) return self.emit('error', err);
    
    // Assert Parts presence.
    if (!data.Parts) return next(new Error('AWS SDK returned invalid object! Expecting Parts.'));
    
    var totalParts = data.Parts.length;
    for (var i = 0; i < totalParts; i++) {
      var part = data.Parts[i];
      
      // Assert part ETag presence.
      if (!part.ETag) return next(new Error('AWS SDK returned invalid object when checking parts! Expecting ETag.'));
      
      // Assert PartNumber presence.
      if (!part.PartNumber) return next(new Error('AWS SDK returned invalid object when checking parts! Expecting PartNumber.'));
      
      if (self.uploadedChunks[part.PartNumber] != part.ETag) {
        return self.emit('error', new Error('Upload failed, ETag of one of the parts mismatched.'));
      }
    }
    
    // All part ETag match (Success!)
    var completeMultipartUploadParams = extendObj({UploadId: this.uploadId}, this.s3Params);
    self.s3Client.completeMultipartUpload(completeMultipartUploadParams, function (err, data) {
      if (err) return self.emit('error', err);
      
      // Assert File ETag presence.
      if (!data.ETag) return next(new Error('AWS SDK returned invalid object! Expecting file Etag.'));
      self.waitingTimer && clearTimeout(self.waitingTimer);
      self.waiting = false;
      self.finished = true;
    });
    
  });
  
  if (this.options.waitTime) {
    this.waitingTimer = setTimeout(function () {
      if (self.waiting) {
        self.emit('error', new Error('AWS did not acknowledge all parts within specified timeout of ' +
        (self.options.waitTime/1000) + ' seconds.'));
      }
    }, self.options.waitTime);
  }
}

module.exports = StreamingS3;