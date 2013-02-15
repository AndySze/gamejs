var gamejs = require('../gamejs');
var uri = require('./utils/uri');

/**
 * @fileoverview
 * Workers are useful to relieve your GameJs application from code which
 * might take long to run. Either expensive algorithms, which might get called
 * every now and then (e.g., path-finding) or another logic being run continously
 * within the rendering loop (e.g., physics engine).
 *
 * A Worker is like a seperate GameJs application being executed - another `main.js`
 * with its own `gamejs.ready()`. The Worker's most important feature is that
 * code executing within it does not block the rendering code. The Worker's
 * greatest limitation is that you can only communicate with it through text
 * messages.
 *
 * See the `examples/workers` directory for a running example.
 *
 *    // Create a worker with the main module "./test"
 *    var fooWorker = new Worker('./test');
 *    // Send a message to your worker.
 *    // The Message doesn't have to be a string but it must be `JSON.stringify()`-able
 *    fooWorker.post("foobar");
 *
 *    // like the `gamejs.event` queue you have to periodically query the
 *    // the worker to get the events it sent
 *    fooWorker.get().forEach(function(event) {
 *       if (event.type === gamejs.worker.WORKER_RESULT) {
 *          gamejs.log('Worker #' + event.worker.id + ' returned ' + event.data);
 *       }
 *     });
 *
 *    // In the worker module, we can send results back to the main application
 *    // by posting them to the gamejs event queue:
 *    gamejs.event.post({expensiveResult: 42});
 *
 */

/** @ignore **/
var WORKER_ERROR = exports.WORKER_ERROR = 1002;
/** @ignore **/
var WORKER_ALIVE = 1003;
/** @ignore **/
var WORKER_LOG = 1004;
/** @ignore **/
var WORKER_RESULT = exports.WORKER_RESULT = 1005;
/** @ignore **/
var WORKER_QUERY = exports.WORKER_QUERY = 1006;

// IMPORTANT READING NOT REGARDING THE FUNCTIONS BELOW
//
// some of the functions here only exist to be `toString()`ified and
// executed with the workers scope on initialization. The comment
// should say so.

/**
 * true if this GameJs instance is being executed within a WebWorker
 * @type Boolean
 */
exports.inWorker = (this.importScripts !== undefined);

/**
 * Executed in scope of worker after user's main module
 * @ignore
 */
exports._ready = function () {
   self.onmessage = function(event) {
      $g.inQueue.push({
         type: 1006,
         data: event.data.data
      })
   };
   self.postMessage({
      type: 1003
   });
};

/**
 * Send message to main context for logging
 * @ignore
 **/
exports._logMessage = function() {
   self.postMessage({
      type: 1004,
      arguments: Array.prototype.slice.apply(arguments)
   });
};

/**
 * Send result message to main context
 * @ignore
 */
exports._postMessage = function(data) {
   self.postMessage({
      type: 1005,
      data: data
   });
};

/**
  * executed in scope of worker before user's main module
  * @ignore
  */
var workerPrefix = function workerPrefix() {
   var $g = $g || {};
   $g.inQueue = [];
   __scripts.forEach(function(script) {
      try {
         importScripts(script)
      } catch (e) {
         // can't help the worker
         throw e;
      }
   });
};

/**
 * Setup a worker which has `require()` defined
 * @ignore
 **/
var create = function(workerModuleId) {
   var moduleRoot = uri.resolve(document.location.href, window.require.getModuleRoot());
   var initialScripts = [];
   Array.prototype.slice.apply(document.getElementsByTagName('script'), [0]).forEach(function(script) {
      if (script.src) {
         initialScripts.push(script.src);
      }
   });

   var URL = window.URL || window.webkitURL;
   var prefixString = workerPrefix.toString();
   // don't be afraid...
   prefixString = prefixString.substring(prefixString.indexOf("{") + 1, prefixString.lastIndexOf("}"));
   var blob = new Blob([
      'var __scripts = ["' + initialScripts.join('","') + '"];',
      prefixString,
      'self.require.setModuleRoot("' + moduleRoot + '");',
      'self.require.run("'+ workerModuleId +'");'
   ], {type: 'application\/javascript'});

   var blobURL = URL.createObjectURL(blob);
   return new Worker(blobURL);
};

/**
 * The `Worker` constructor takes only one argument: a module id. This module
 * will be executed inside the newly created Worker. It is effectively the
 * main module of the Worker and will look like a typical GameJs main module
 * with a `gamejs.ready()`, etc.
 *
 * Sending events to and from the Worker
 * --------------------------------------
 *
 * Each worker has its own gamejs.event queue. The main thread can send events to
 * the worker by calling `worker.post(data)`. The worker then retrieves such
 * events with the normal `gamejs.event.get()`.
 *
 * To send events to the main thread, the worker uses `gamejs.event.post()`. The main
 * thread can retrieve those events by calling `worker.get()`.
 *
 * If you think this sounds complicated, take a look at this ASCII diagram:
 *
 *     Worker               |   Main Thread   |   Event type
 *     --------------------------------------------------------------
 *     gamejs.event.post() -->  worker.get()      gamejs.worker.RESULT
 *     gamejs.event.get()  <--  worker.post()     gamejs.worker.QUERY
 *
 * Accessible modules (or lack thereof)
 * --------------------------
 *
 * **Note:** A Worker does not have access to the browser's `document`. So
 * a lot of GameJs modules - everything related to drawing to the canvas -
 * do not work in the Worker.
 *
 * You can use `gamejs.time.*`, `gamejs.utils.*`, `gamejs.event.*` and probably others
 * (as well as any module you write yourself for this purpose, of course).
 *
 * @param {String} moduleId The Worker's main module id. The main module will be executed in the worker
 */
exports.Worker = function(moduleId) {
   // FIXME id should be unchangeable
   /**
    * Unique id of this worker
    * @property {Number}
    */
   var id = this.id = guid(moduleId);
   var worker = create(moduleId);
   // queue events until worker is alive
   var deadQueue = [];
   // events coming out from worker to main thread
   var outQueue = [];
   var alive = false;
   var self  = this;

   worker.onmessage = function(event) {
      event = event.data;
      if (event.type === WORKER_ALIVE) {
         alive = true;
         deadQueue.forEach(function(data) {
            self.post(data);
         });
      } else if (event.type === WORKER_LOG) {
         gamejs.log.apply(null, [id].concat(event.arguments));
      } else {
         outQueue.push({
            type: WORKER_RESULT,
            data: event.data,
            worker: self
         });
      }
   };
   worker.onerror = function(event) {
      gamejs.error('Error in worker "' + id + '" line ' + event.lineno + ': ', event.message)
      outQueue.push({
         type: WORKER_ERROR,
         error: event
      });
   };

   /**
    * Send a message to the worker
    *
    * @param {Object} data Payload object which gets sent to the Worker
    */
   this.post = function(data) {
      if (alive) {
         worker.postMessage({
            data: data,
            type: WORKER_QUERY
         });
      } else {
         deadQueue.push(data);
      }
   };

   // @@ implement types arg
   this.get = function() {
      return outQueue.splice(0);
   }
   return this;
}

/**
 * not a real GUID
 * @ignore
 */
function guid(moduleId) {
   var S4 = function() {
      return (((1+Math.random())*0x10000)|0).toString(16).substring(1);
   };
   return moduleId + '@' + (S4()+S4());
}
