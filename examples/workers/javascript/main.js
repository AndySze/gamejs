/**
 * Creates a Worker which - given a starting number - will produce
 * primes coming after that number.
 *
 * This examples shows how messages are being sent from and to a worker, and that
 * the number-crunching worker does not block the browser's UI (like a normal script
 * running this long would).
 */

var gamejs = require('gamejs');


function main() {
   // screen setup
   var display = gamejs.display.setMode([800, 600]);
   gamejs.display.setCaption("Example Workers");
   var font = new gamejs.font.Font();

   // create a background worker
   var primeWorker = new gamejs.worker.Worker('./primes');

   // send a question to the worker
   var startNumber = parseInt(1230023 + (Math.random() * 10000));
   display.blit(font.render('Asking worker for primes after ' + startNumber), [10,30]);
   primeWorker.post({
      todo: "nextprimes", start: startNumber
   });

   var yOffset = 50;
   var tick = function(msDuration) {
      // handle worker results if any
      primeWorker.get().forEach(function(event) {
         if (event.type === gamejs.worker.WORKER_RESULT) {
            display.blit(font.render('Worker answered: ' + event.data.prime), [10, yOffset])
            yOffset += 20;
         } else if (event.type === gamejs.worker.WORKER_ERROR) {
            // (contrieved since gamejs already logs worker erros)
            gamejs.error('got an error!', event.lineno, event.message)
         }
      })
      // good practice: consume all keyboard/mouse events
      gamejs.event.get();
   };
   gamejs.time.interval(tick);
}

gamejs.ready(main);
