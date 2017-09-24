var EventEmitter = require('events').EventEmitter,
    util = require('util'),
    async = require('async'),
    aws = require('aws-sdk');


function extendObj(a, b) {
  for (var x in b) a[x] = b[x];
  return a;
}
 
// New (>= 0.4) function StreamingS3(stream, awsConfig, s3Params, options, cb)
function StreamingS3(stream, s3AccessKey, s3SecretKey, s3Params, options, cb) {
  var self = this;
  
  // Lets hook our error event in the start so we can easily emit errors.
  this.on('error', function(e) {
    if (self.failed || self.finished) return;
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
      var abortMultipartUploadParams = extendObj({UploadId: self.uploadId}, self.s3ObjectParams);
      self.s3Client.abortMultipartUpload(abortMultipartUploadParams, function(err, data) {
        if (err) {
          self.cb && self.cb(err); // We can't do anything if aborting fails :'(
          self.cb = null;
          return;
        }
        self.cb && self.cb(e);
        self.cb = null;
      });
    } else {
      self.cb && self.cb(e);
      self.cb = null;
    }
  });
  
  
  var awsConfigObject = {accessKeyId: s3AccessKey, secretAccessKey: s3SecretKey};
  
  if (typeof s3AccessKey == 'object') {
    cb = options;
    options = s3Params;
    s3Params = s3SecretKey;
    awsConfigObject = s3AccessKey;
    s3AccessKey = awsConfigObject.accessKeyId;
    s3SecretKey = awsConfigObject.secretAccessKey;
  }
  
  if (typeof options == 'function') {
    cb = options;
    options = {};
  }
  
  var defaultOptions = {
    concurrentParts: 5, // Concurrent parts that will be uploaded to s3 (if read stream is fast enough)
    waitTime: 60000, // In seconds (Only applies once all parts are uploaded, used for acknowledgement), 0 = Unlimited
    retries: 5, // Number of times to retry a part.
    sdkRetries: 6, // Passed onto the underlying aws-sdk.
    maxPartSize: 5 * 1024 * 1024 // In bytes, will also consume this much buffering memory.
  };
  
  options = extendObj(defaultOptions, options);
  this.options = options;
  
  if (options.sdkRetries) awsConfigObject.maxRetries = options.sdkRetries;
  
  // S3 Parameters and properties
  aws.config.update(awsConfigObject);
  this.s3ObjectParams = {
    Bucket: s3Params.Bucket || s3Params.bucket,
    Key: s3Params.Key || s3Params.key
  };
  
  if (!this.s3ObjectParams.Bucket || !this.s3ObjectParams.Key) {
    return this.emit('error', new Error('Bucket and Key parameters for S3 Object are required!'));
  }
  
  this.stream = stream;
  
  // States
  this.waiting = false;
  this.initiated = false;
  this.failed = false;
  this.reading = false;
  this.finished = false;
  
  // Stats
  this.stats = {downloadSpeed: 0, uploadSpeed: 0, downloadTime: 0, uploadTime: 0, size: 0};
  this.uploadStart = 0;
  this.downloadStart = 0;
  this.totalBytes = 0;
  
  // Chunking and buffering
  this.buffer = new Buffer(0);
  this.chunks = [];
  this.chunkNumber = 0;
  this.totalChunks = 0;
  this.uploadedChunks = {}; // We just store ETags of all parts, not the actual buffer.
  
  
  this.s3Params = s3Params;
  this.s3Client = this.getNewS3Client();
  this.uploadId = null;
  this.cb = cb;
  
  // Timers
  this.waitingTimer = false;
  this.acknowledgeTimer = false;
  
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
};

StreamingS3.prototype.begin = function() {
  if (this.initiated || this.finished) return;
  
  var self = this;
  
  this.streamErrorHandler = function(err) {
    self.emit('error', err);
  };
  
  this.streamDataHandler = function(chunk) {
    self.reading = true;
    if (!self.downloadStart) self.downloadStart = Date.now();
    if (typeof chunk === 'string') chunk = new Buffer(chunk, 'utf-8');
    self.totalBytes += chunk.length;
    self.buffer = Buffer.concat([self.buffer, chunk]);
    self.emit('data', chunk.length);
    if (self.buffer.length >= self.options.maxPartSize) {
      self.flushChunk();
    }
  };
  
  this.streamEndHandler = function() {
    self.reading = false;
    if (self.downloadStart) {
      self.stats.downloadTime = Math.round((Date.now() - self.downloadStart) / 1000, 3);
      self.stats.downloadSpeed = Math.round(self.totalBytes / (self.stats.downloadTime / 1000), 2);
    }
    self.flushChunk();
  };
    
  async.series(
    {
      createMultipartUpload: function(callback) {
        var createMultipartUploadParams = extendObj(self.s3Params, self.s3ObjectParams);
        self.s3Client.createMultipartUpload(createMultipartUploadParams, function(err, data) {
          if (err) return self.emit('error', err);
          
          // Assert UploadId presence.
          if (!data.UploadId) return callback(new Error('AWS SDK returned invalid object! Expecting UploadId.'));
        
          self.uploadId = data.UploadId;
          callback();
        });
      }
    }, function(err, results) {
      if (err) return self.emit('error', err);
      self.initiated = true;
      self.stream.on('error', self.streamErrorHandler);
      self.stream.on('data', self.streamDataHandler);
      self.stream.on('end', self.streamEndHandler);
      self.stream.resume();
    });
};

StreamingS3.prototype.flushChunk = function() {
  if (!this.initiated || !this.uploadId) return;
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
  newChunk.number = ++this.chunkNumber;
  newChunk.retries = 0;
  this.chunks.push(newChunk);
  this.totalChunks++;
    
  // Edge case
  if (this.reading === false && this.buffer.length) {
    newChunk = this.buffer.slice(0, this.buffer.length);
    this.buffer = null;
    newChunk.uploading = false;
    newChunk.finished = false;
    newChunk.number = ++this.chunkNumber;
    newChunk.retries = 0;
    this.chunks.push(newChunk);
    this.totalChunks++;
  }
    
  this.sendToS3();
};


StreamingS3.prototype.sendToS3 = function() {
  if (!this.uploadId || this.waiting) return;
  var self = this;
  
  if (!this.uploadStart) this.uploadStart = Date.now();
  
  function uploadChunk(chunk, next) {
    if (!self.uploadId || !self.initiated || self.failed || chunk.uploading || chunk.finished || chunk.number < 0) return next();
    
    chunk.uploading = true;
    chunk.client = chunk.client ? chunk.client : self.getNewS3Client();
    
    var partS3Params = {
      UploadId: self.uploadId,
      PartNumber: chunk.number,
      Body: chunk
    };
    
    partS3Params = extendObj(partS3Params, self.s3ObjectParams);
    chunk.client.uploadPart(partS3Params, function(err, data) {
      if (err) {
        if (err.code === 'RequestTimeout') {
          if (chunk.retries >= self.options.retries) return next(err);
          else {
            chunk.uploading = false;
            chunk.retries++;
            return uploadChunk(chunk, next);
          }
        } else {
          chunk.finished = true;
          return next(err);
        }
      } else {
        // Assert ETag presence.
        if (!data.ETag) return next(new Error('AWS SDK returned invalid object when part uploaded! Expecting Etag.'));
        
        // chunk.number starts at 1, while array starts at 0.
        self.uploadedChunks[chunk.number] = data.ETag;
        chunk.finished = true;
        self.emit('part', chunk.number);
        return next();
      }
    });
    
  }
  
  // Remove finished chunks, save memory :)
  this.chunks = this.chunks.filter(function(chunk) {
    return chunk.finished === false;
  });
  
  if (this.chunks.length) {
    
    async.eachLimit(this.chunks, this.options.concurrentParts, uploadChunk, function(err) {
      if (err) return self.emit('error', err);
      
      // Remove finished chunks, save memory :)
      self.chunks = self.chunks.filter(function(chunk) {
        return chunk.finished === false;
      });
      
      if (self.chunks.length === 0 && !self.waiting && !self.reading && self.totalChunks === Object.keys(self.uploadedChunks).length) {
        if (self.uploadStart) {
          self.stats.uploadTime = Math.round((Date.now() - self.uploadStart) / 1000, 3);
          self.stats.uploadSpeed = Math.round(self.totalBytes / (self.stats.uploadTime / 1000), 2);
        }
        self.stats.size = self.totalBytes;
        self.emit('uploaded', self.stats);
        self.waiting = true;
        
        // Give S3 some breating time, before we check if the upload succeeded
        self.acknowledgeTimer = setTimeout(function() { self.finish(); }, 500);
      }
      
    });
    
  }
  
};

StreamingS3.prototype.finish = function() {
  if (!this.uploadId || this.failed || this.finished) {
    this.acknowledgeTimer && clearTimeout(this.acknowledgeTimer);
    return;
  }
  
  this.acknowledgeTimer && clearTimeout(this.acknowledgeTimer);
  
  var self = this;
  
  var listPartsParams = extendObj({UploadId: this.uploadId, MaxParts: this.totalChunks}, this.s3ObjectParams);
  this.s3Client.listParts(listPartsParams, function(err, data) {
    if (err) return self.emit('error', err);
    
    if (!self.acknowledgeTimer) self.acknowledgeTimer = setTimeout(function() { self.finish(); }, 1000);
    
    // Assert Parts presence.
    if (!data.Parts) return self.emit('error', new Error('AWS SDK returned invalid object! Expecting Parts.'));
    if (data.Parts.length !== self.totalChunks) return;
    
    // S3 has all parts Lets send ETags.
    var completeMultipartUploadParams = {
      UploadId: self.uploadId,
      MultipartUpload: {
        Parts: []
      }
    };
    
    for (var key in self.uploadedChunks) {
      completeMultipartUploadParams.MultipartUpload.Parts.push({ETag: self.uploadedChunks[key], PartNumber: key});
    }
    
    completeMultipartUploadParams = extendObj(completeMultipartUploadParams, self.s3ObjectParams);
    self.s3Client.completeMultipartUpload(completeMultipartUploadParams, function(err, data) {
      if (err) return self.emit('error', err);
      
      // Assert File ETag presence.
      if (!data.ETag) return self.emit('error', new Error('AWS SDK returned invalid object! Expecting file Etag.'));
      self.waitingTimer && clearTimeout(self.waitingTimer);
      self.acknowledgeTimer && clearTimeout(self.acknowledgeTimer);
      self.initiated = false;
      self.waiting = false;
      self.finished = true;
      self.emit('finished', data, self.stats);
      self.cb && self.cb(null, data, self.stats); // Done :D
      // prevent any further callback calls.
      self.cb = null;
    });
    
  });
  
    
  // Make sure we don't keep checking for parts forever.
  if (!this.waitingTimer && this.options.waitTime) {
    this.waitingTimer = setTimeout(function() {
      if (self.waiting && !self.finished) {
        return self.emit('error', new Error('AWS did not acknowledge all parts within specified timeout of ' + (self.options.waitTime / 1000) + ' seconds.'));
      }
    }, self.options.waitTime);
  }
  
};

module.exports = StreamingS3;