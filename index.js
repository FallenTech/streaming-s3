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
    cb = options;
    options = {};
  }
  
  var defaultOptions = {
     concurrentParts: 5,        // Concurrent parts that will be uploaded to s3 (if read stream is fast enough)
     waitTime: 60000,           // In seconds (Only applies once all parts are uploaded, used for acknowledgement), 0 = Unlimited
     retries: 5,                // Number of times to retry a part.
     maxPartSize: 5*1024*1024,  // In bytes, will also consume this much buffering memory.
  }
  
  options = extendObj(options, defaultOptions);
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
  aws.config.update({accessKeyId: s3AccessKey, secretAccessKey: s3SecretKey, region: s3Params.region? s3Params.region : 'us-east-1'});
  this.s3Client = this.getNewS3Client();
  this.s3Params = s3Params;
  this.s3AccessKey = s3AccessKey;
  this.s3SecretKey = s3SecretKey;
  this.uploadId = null;
  this.cb = cb;
  
  // Timers
  this.waitingTimer = false;
  this.acknowledgeTimer = false;
  
  var self = this;
  
  this.on('error', function (e) {
    if (self.failed) return;
    self.waitingTimer && clearTimeout(self.waitingTimer);
    self.acknowledgeTimer && clearTimeout(self.acknowledgeTimer);
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
      var abortMultipartUploadParams = extendObj({UploadId: self.uploadId}, self.s3Params);
      delete abortMultipartUploadParams['ACL'], delete abortMultipartUploadParams['StorageClass']; // AWS fails with these parameters.
      self.s3Client.abortMultipartUpload(abortMultipartUploadParams, function (err, data) {
        if (err) self.cb && self.cb(err); // We can't do anything if aborting fails :'(
        self.cb && self.cb(e);
      })
    } else self.cb && self.cb(e);
    
  });
  
  // Pause the stream until we hook our events.
  if (stream) stream.pause();
  else this.emit('error', new Error('You must provide a readable stream.'));
  
  // if callback provided then begin, else wait for call to begin.
  cb && this.begin();
  return this;
}

util.inherits(StreamingS3, EventEmitter);

StreamingS3.prototype.getNewS3Client = function() {
  return (new aws.S3());
}

StreamingS3.prototype.begin = function() {
  if (this.initiated) return; // Ignore calls if user has provided callback.
  
  this.streamErrorHandler = function (err) {
    self.emit('error', err);
  }
  
  this.streamDataHandler = function (chunk) {
    self.reading = true;
    if (typeof chunk === 'string') chunk = new Buffer(chunk, 'utf-8');
    self.buffer = Buffer.concat([self.buffer, chunk]);
    if (self.buffer.length >= self.options.maxPartSize) {
      self.flushChunk();
    }
  }
  
  this.streamEndHandler = function () {
    self.reading = false;
    self.flushChunk();
  }
  
  var self = this;
    
  async.series({
    createMultipartUpload: function (callback) {
      self.s3Client.createMultipartUpload(self.s3Params, function (err, data) {
        if (err) return self.emit('error', err);
        
        // Assert UploadId presence.
        if (!data.UploadId) return callback(new Error('AWS SDK returned invalid object! Expecting UploadId.'));
      
        self.uploadId = data.UploadId;
        callback();
      });
    }}, function (err, results) {
      if (err) return self.emit('error', err);
      self.initiated = true;
      self.stream.on('error', self.streamErrorHandler);
      self.stream.on('data', self.streamDataHandler);
      self.stream.on('end', self.streamEndHandler);
      self.stream.resume();
    }); 
  
}

StreamingS3.prototype.flushChunk = function() {
  if (!this.initiated) return;
  var newChunk;
    if (this.buffer.length > this.options.maxPartSize) {
      newChunk = this.buffer.slice(0, this.options.maxPartSize);
      this.buffer = new Buffer(this.buffer.slice(this.options.maxPartSize));
    } else {
      newChunk = this.buffer.slice(0, this.options.maxPartSize);
      this.buffer = new Buffer(0);
    }
    
    // Add useful properties to each chunk.
    newChunk.uploading = false;
    newChunk.finished = false;
    newChunk.number = ++this.totalChunks;
    newChunk.retries = 0;
    this.chunks.push(newChunk);
    
    // Edge case
    if (this.reading == false && this.buffer.length) {
      newChunk = this.buffer.slice(0, this.buffer.length);
      this.buffer = null;
      newChunk.uploading = false;
      newChunk.finished = false;
      newChunk.number = ++this.totalChunks;
      newChunk.retries = 0;
      this.chunks.push(newChunk);
    }
    
    this.sendToS3();
}


StreamingS3.prototype.sendToS3 = function() {
  var self = this;
  
  this.uploadChunk = function (chunk, next) {
    if (self.failed) return next();
    else if (chunk.uploading) return next();
    else if (!chunk.number) return next();
    
    chunk.uploading = true;
    chunk.client = chunk.client ? chunk.client : self.getNewS3Client();
    
    var partS3Params = {
      UploadId: self.uploadId,
      PartNumber: chunk.number,
      Body: chunk
    }
    
    partS3Params = extendObj(partS3Params, self.s3Params);
    delete partS3Params['ACL'], delete partS3Params['StorageClass']; // AWS fails with these parameters.
    
    chunk.client.uploadPart(partS3Params, function (err, data) {
      if (err) {
        if (err.code == 'RequestTimeout') {
          if (chunk.retries >= self.options.retries) return next(err);
          else {
            chunk.uploading = false;
            chunk.retries++;
            return self.uploadChunk(chunk, next);
          }
        } else return next(err);
      }
      
      // Assert ETag presence.
      if (!data.ETag) return next(new Error('AWS SDK returned invalid object when part uploaded! Expecting Etag.'));
      self.uploadedChunks[chunk.number] = data.ETag;
      chunk.finished = true;
      next();
    });
    
  }
  
  if (this.chunks.length) {
    
    // Remove finished chunks, save memory :)
    this.chunks = this.chunks.filter(function (chunk) {
      return chunk.finished == false;
    });
    
    var finishedReading = !self.reading;
    
    async.eachLimit(this.chunks, this.options.concurrentParts, this.uploadChunk, function (err) {
      if (self.failed) return;
      if (err) return self.emit('error', err);
      self.waiting = true;
      if (finishedReading == true) {
        // Give AWS some breathing time before checking for parts.
        setTimeout(function() { self.finish(); }, 500);
      }
    });
    
  }
  
}

StreamingS3.prototype.finish = function() {
  if (this.failed) return;
  else if (!this.uploadId) return this.emit('error', new Error('No AWS S3 Upload ID set, make sure you provide callback or call init on the object.'));
  else if (this.finished) return;
  
  var self = this;
  
  var listPartsParams = extendObj({UploadId: this.uploadId, MaxParts: this.totalChunks}, this.s3Params);
  delete listPartsParams['ACL'], delete listPartsParams['StorageClass']; // AWS fails with these parameters.
  this.s3Client.listParts(listPartsParams, function (err, data) {
    if (err) return self.emit('error', err);
    
    // Assert Parts presence.
    if (!data.Parts) return self.emit('error', new Error('AWS SDK returned invalid object! Expecting Parts.'));
    
    var totalParts = data.Parts.length;
    if (totalParts != data.Parts.length) return; // Wait for next interval call.
    
    for (var i = 0; i < totalParts; i++) {
      var part = data.Parts[i];
      
      // Assert part ETag presence.
      if (!part.ETag) return self.emit('error', new Error('AWS SDK returned invalid object when checking parts! Expecting ETag.'));
      
      // Assert PartNumber presence.
      if (!part.PartNumber) return self.emit('error', new Error('AWS SDK returned invalid object when checking parts! Expecting PartNumber.'));
      
      if (self.uploadedChunks[part.PartNumber] != part.ETag) {
        return self.emit('error', new Error('Upload failed, ETag of one of the parts mismatched.'));
      }
    }
    
    // All part ETag match (Success!)
    var completeMultipartUploadParams = {
      UploadId: self.uploadId,
      MultipartUpload: {
        Parts: []
      }
    }
    
    var totalUploadedChunks = self.uploadedChunks.length;
    for (var key in self.uploadedChunks) {
      completeMultipartUploadParams.MultipartUpload.Parts.push({ETag: self.uploadedChunks[key], PartNumber: key});
    }
    
    var completeMultipartUploadParams = extendObj(completeMultipartUploadParams, self.s3Params);
    delete completeMultipartUploadParams['ACL'], delete completeMultipartUploadParams['StorageClass']; // AWS fails with these parameters.
    self.s3Client.completeMultipartUpload(completeMultipartUploadParams, function (err, data) {
      if (err) return self.emit('error', err);
      
      // Assert File ETag presence.
      if (!data.ETag) return self.emit('error', new Error('AWS SDK returned invalid object! Expecting file Etag.'));
      self.acknowledgeTimer && clearTimeout(self.acknowledgeTimer);
      self.waitingTimer && clearTimeout(self.waitingTimer);
      self.waiting = false;
      self.finished = true;
      self.cb && self.cb(null, data); // Done :D
    });
    
  });
  
  // Make sure we don't keep checking for parts forever.
  if (!this.waitingTimer && this.options.waitTime) {
    this.waitingTimer = setTimeout(function () {
      if (self.waiting) {
        self.emit('error', new Error('AWS did not acknowledge all parts within specified timeout of ' +
        (self.options.waitTime/1000) + ' seconds.'));
      }
    }, self.options.waitTime);
  }
  
  // Keep checking for parts until AWS confirms them all.
  if (!this.acknowledgeTimer) this.acknowledgeTimer = setInterval(function() { self.finish(); }, 5000);
}

module.exports = StreamingS3;