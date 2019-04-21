module.exports = function captureMySQL({
  mysql = require('mysql'),
  onReady = (x, y) => { },
  onExecute = x => { },
  onError = x => { } }) {
  if (mysql.__createConnection)
    return mysql;

  function patchCreateConnection(mysql) {
    var baseFcn = '__createConnection';
    mysql[baseFcn] = mysql['createConnection'];

    mysql['createConnection'] = function patchedCreateConnection() {
      var connection = mysql[baseFcn].apply(connection, arguments);
      if (connection instanceof Promise) {
        connection = connection.then((result) => {
          patchObject(result.connection);
          return result;
        });
      } else if (connection.query instanceof Function) {
        patchObject(connection);
      }
      return connection;
    };
  }

  function patchCreatePool(mysql) {
    var baseFcn = '__createPool';
    mysql[baseFcn] = mysql['createPool'];

    mysql['createPool'] = function patchedCreatePool() {
      var pool = mysql[baseFcn].apply(pool, arguments);
      if (pool instanceof Promise) {
        pool = pool.then((result) => {
          patchObject(result.pool);
          return result;
        });
      } else if (pool.query instanceof Function) {
        patchObject(pool);
      }
      return pool;
    };
  }

  function patchCreatePoolCluster(mysql) {
    var baseFcn = '__createPoolCluster';
    mysql[baseFcn] = mysql['createPoolCluster'];

    mysql['createPoolCluster'] = function patchedCreatePoolCluster() {
      var poolCluster = mysql[baseFcn].apply(poolCluster, arguments);
      if (poolCluster.query instanceof Function) {
        patchObject(poolCluster);
      }
      return poolCluster;
    };
  }

  function patchOf(poolCluster) {
    var baseFcn = '__of';
    poolCluster[baseFcn] = poolCluster['of'];
    poolCluster['of'] = function patchedOf() {
      var args = arguments;
      var resultPool = poolCluster[baseFcn].apply(poolCluster, args);
      return patchObject(resultPool);
    }
  }

  function patchObject(connection) {
    if (connection.query instanceof Function && !connection.__query) {
      connection.__query = connection.query;
      connection.query = captureOperation('query');
    }

    if (connection.execute instanceof Function && !connection.__execute) {
      connection.__execute = connection.execute;
      connection.execute = captureOperation('execute');
    }

    // Patches the of function on a mysql PoolCluster which returns a pool
    if (connection.of instanceof Function && !connection.__of) {
      patchOf(connection);
    }
    return connection;
  }

  function resolveArguments(argsObj) {
    var args = {};

    if (argsObj && argsObj.length > 0) {
      if (argsObj[0] instanceof Object) {
        args.sql = argsObj[0].sql;
        args.values = argsObj[0].values;
        args.callback = argsObj[1];
        args.spanContext = argsObj[2];
      } else {
        args.sql = argsObj[0];
        args.values = typeof argsObj[1] !== 'function' ? argsObj[1] : null;
        args.callback = typeof argsObj[1] === 'function' ? argsObj[1] : (typeof argsObj[2] === 'function' ? argsObj[2] : undefined);
        args.spanContext = argsObj[3];
      }
    }

    return args;
  }

  function captureOperation(name) {
    return function () {
      var args = resolveArguments(arguments);
      var command;
      var originalOperation = this['__' + name];
      var context = onReady(args.spanContext, name, args);
      if (args.callback) {
        var cb = args.callback;
        args.callback = function wrappedCallback(err, data) {
          // do sth.
          onExecute(context, data);
          cb(err, data);
        };
      }
      command = originalOperation.call(this, args.sql, args.values, args.callback, args.spanContext);

      if (!args.callback) {
        command.on('end', function () {
          onExecute(context, arguments);
        });

        var errorCapturer = function (err) {
          onError(context, err);
          if (this._events && this._events.error && this._events.error.length === 1) {
            this.removeListener('error', errorCapturer);
            this.emit('error', err);
          }
        };
        command.on('error', errorCapturer);
      }
      return command;
    }
  }

  patchCreateConnection(mysql);
  patchCreatePool(mysql);
  patchCreatePoolCluster(mysql);
  return mysql;
};
