"use strict";
/**
 * database.js
 *
 * Layer between the database and the application
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var Sqlite3Database = require('better-sqlite3');
var Run = require('run-sdk');
var bsv = require('bsv');
// ------------------------------------------------------------------------------------------------
// Globals
// ------------------------------------------------------------------------------------------------
var HEIGHT_MEMPOOL = -1;
var HEIGHT_UNKNOWN = null;
// The + in the following 2 queries before downloaded improves performance by NOT using the
// tx_downloaded index, which is rarely an improvement over a simple filter for single txns.
// See: https://www.sqlite.org/optoverview.html
var IS_READY_TO_EXECUTE_SQL = "\n      SELECT (\n        downloaded = 1\n        AND executable = 1\n        AND executed = 0\n        AND (has_code = 0 OR (SELECT COUNT(*) FROM trust WHERE trust.txid = tx.txid AND trust.value = 1) = 1)\n        AND txid NOT IN ban\n        AND (\n          SELECT COUNT(*)\n          FROM tx AS tx2\n          JOIN deps\n          ON deps.up = tx2.txid\n          WHERE deps.down = tx.txid\n          AND (+tx2.downloaded = 0 OR (tx2.executable = 1 AND tx2.executed = 0) OR (tx2.executed = 1 and tx2.indexed = 0))\n        ) = 0\n      ) AS ready \n      FROM tx\n      WHERE txid = ?\n    ";
var GET_DOWNSTREADM_READY_TO_EXECUTE_SQL = "\n      SELECT down\n      FROM deps\n      JOIN tx\n      ON tx.txid = deps.down\n      WHERE up = ?\n      AND +downloaded = 1\n      AND executable = 1\n      AND executed = 0\n      AND (has_code = 0 OR (SELECT COUNT(*) FROM trust WHERE trust.txid = tx.txid AND trust.value = 1) = 1)\n      AND txid NOT IN ban\n      AND (\n        SELECT COUNT(*)\n        FROM tx AS tx2\n        JOIN deps\n        ON deps.up = tx2.txid\n        WHERE deps.down = tx.txid\n        AND (+tx2.downloaded = 0 OR (tx2.executable = 1 AND tx2.executed = 0))\n      ) = 0\n    ";
var Database = /** @class */ (function () {
    function Database(path, logger, readonly) {
        if (readonly === void 0) { readonly = false; }
        this.path = path;
        this.logger = logger;
        this.db = null;
        this.readonly = readonly;
        this.onReadyToExecute = null;
        this.onAddTransaction = null;
        this.onDeleteTransaction = null;
        this.onTrustTransaction = null;
        this.onUntrustTransaction = null;
        this.onBanTransaction = null;
        this.onUnbanTransaction = null;
        this.onRequestDownload = null;
    }
    Database.prototype.open = function () {
        this.logger.debug('Opening' + (this.readonly ? ' readonly' : '') + ' database');
        if (this.db)
            throw new Error('Database already open');
        this.db = new Sqlite3Database(this.path, { readonly: this.readonly });
        // 100MB cache
        this.db.pragma('cache_size = 6400');
        this.db.pragma('page_size = 16384');
        // WAL mode allows simultaneous readers
        this.db.pragma('journal_mode = WAL');
        // Synchronizes WAL at checkpoints
        this.db.pragma('synchronous = NORMAL');
        if (!this.readonly) {
            // Initialise and perform upgrades
            this.initializeV1();
            this.initializeV2();
            this.initializeV3();
            this.initializeV4();
            this.initializeV5();
            this.initializeV6();
            this.initializeV7();
        }
        this.addNewTransactionStmt = this.db.prepare('INSERT OR IGNORE INTO tx (txid, height, time, bytes, has_code, executable, executed, indexed) VALUES (?, null, ?, null, 0, 0, 0, 0)');
        this.setTransactionBytesStmt = this.db.prepare('UPDATE tx SET bytes = ? WHERE txid = ?');
        this.setTransactionExecutableStmt = this.db.prepare('UPDATE tx SET executable = ? WHERE txid = ?');
        this.getTransactionExecutableStmt = this.db.prepare('SELECT executable FROM tx WHERE txid = ?');
        this.setTransactionTimeStmt = this.db.prepare('UPDATE tx SET time = ? WHERE txid = ?');
        this.setTransactionHeightStmt = this.db.prepare("UPDATE tx SET height = ? WHERE txid = ? AND (height IS NULL OR height = ".concat(HEIGHT_MEMPOOL, ")"));
        this.setTransactionHasCodeStmt = this.db.prepare('UPDATE tx SET has_code = ? WHERE txid = ?');
        this.setTransactionExecutedStmt = this.db.prepare('UPDATE tx SET executed = ? WHERE txid = ?');
        this.setTransactionIndexedStmt = this.db.prepare('UPDATE tx SET indexed = ? WHERE txid = ?');
        this.hasTransactionStmt = this.db.prepare('SELECT txid FROM tx WHERE txid = ?');
        this.getTransactionHexStmt = this.db.prepare('SELECT LOWER(HEX(bytes)) AS hex FROM tx WHERE txid = ?');
        this.getTransactionTimeStmt = this.db.prepare('SELECT time FROM tx WHERE txid = ?');
        this.getTransactionHeightStmt = this.db.prepare('SELECT height FROM tx WHERE txid = ?');
        this.getTransactionHasCodeStmt = this.db.prepare('SELECT has_code FROM tx WHERE txid = ?');
        this.getTransactionIndexedStmt = this.db.prepare('SELECT indexed FROM tx WHERE txid = ?');
        this.getTransactionFailedStmt = this.db.prepare('SELECT (executed = 1 AND indexed = 0) AS failed FROM tx WHERE txid = ?');
        this.getTransactionDownloadedStmt = this.db.prepare('SELECT downloaded FROM tx WHERE txid = ?');
        this.deleteTransactionStmt = this.db.prepare('DELETE FROM tx WHERE txid = ?');
        this.unconfirmTransactionStmt = this.db.prepare("UPDATE tx SET height = ".concat(HEIGHT_MEMPOOL, " WHERE txid = ?"));
        this.getTransactionsAboveHeightStmt = this.db.prepare('SELECT txid FROM tx WHERE height > ?');
        this.getMempoolTransactionsBeforeTimeStmt = this.db.prepare("SELECT txid FROM tx WHERE height = ".concat(HEIGHT_MEMPOOL, " AND time < ?"));
        this.getTransactionsToDownloadStmt = this.db.prepare('SELECT txid FROM tx WHERE downloaded = 0');
        this.getTransactionsDownloadedCountStmt = this.db.prepare('SELECT COUNT(*) AS count FROM tx WHERE downloaded = 1');
        this.getTransactionsIndexedCountStmt = this.db.prepare('SELECT COUNT(*) AS count FROM tx WHERE indexed = 1');
        this.isReadyToExecuteStmt = this.db.prepare(IS_READY_TO_EXECUTE_SQL);
        this.getDownstreamReadyToExecuteStmt = this.db.prepare(GET_DOWNSTREADM_READY_TO_EXECUTE_SQL);
        this.setSpendStmt = this.db.prepare('INSERT OR REPLACE INTO spends (location, spend_txid) VALUES (?, ?)');
        this.setUnspentStmt = this.db.prepare('INSERT OR IGNORE INTO spends (location, spend_txid) VALUES (?, null)');
        this.getSpendStmt = this.db.prepare('SELECT spend_txid FROM spends WHERE location = ?');
        this.unspendOutputsStmt = this.db.prepare('UPDATE spends SET spend_txid = null WHERE spend_txid = ?');
        this.deleteSpendsStmt = this.db.prepare('DELETE FROM spends WHERE location LIKE ? || \'%\'');
        this.addDepStmt = this.db.prepare('INSERT OR IGNORE INTO deps (up, down) VALUES (?, ?)');
        this.deleteDepsStmt = this.db.prepare('DELETE FROM deps WHERE down = ?');
        this.getDownstreamStmt = this.db.prepare('SELECT down FROM deps WHERE up = ?');
        this.getUpstreamUnexecutedCodeStmt = this.db.prepare("\n      SELECT txdeps.txid as txid\n      FROM (SELECT up AS txid FROM deps WHERE down = ?) as txdeps\n      JOIN tx ON tx.txid = txdeps.txid\n      WHERE tx.executable = 1 AND tx.executed = 0 AND tx.has_code = 1\n    ");
        this.getUpstreamStmt = this.db.prepare("\n      SELECT up as txid FROM tx\n      JOIN deps ON deps.up = tx.txid\n      WHERE\n        deps.down = ?\n    ");
        this.setJigStateStmt = this.db.prepare('INSERT OR IGNORE INTO jig (location, state, class, lock, scripthash) VALUES (?, ?, null, null, null)');
        this.setJigClassStmt = this.db.prepare('UPDATE jig SET class = ? WHERE location = ?');
        this.setJigLockStmt = this.db.prepare('UPDATE jig SET lock = ? WHERE location = ?');
        this.setJigScripthashStmt = this.db.prepare('UPDATE jig SET scripthash = ? WHERE location = ?');
        this.getJigStateStmt = this.db.prepare('SELECT state FROM jig WHERE location = ?');
        this.deleteJigStatesStmt = this.db.prepare('DELETE FROM jig WHERE location LIKE ? || \'%\'');
        var getAllUnspentSql = "\n      SELECT spends.location AS location FROM spends\n      JOIN jig ON spends.location = jig.location\n      WHERE spends.spend_txid IS NULL";
        this.getAllUnspentStmt = this.db.prepare(getAllUnspentSql);
        this.getAllUnspentByClassStmt = this.db.prepare("".concat(getAllUnspentSql, " AND jig.class = ?"));
        this.getAllUnspentByLockStmt = this.db.prepare("".concat(getAllUnspentSql, " AND jig.lock = ?"));
        this.getAllUnspentByScripthashStmt = this.db.prepare("".concat(getAllUnspentSql, " AND jig.scripthash = ?"));
        this.getAllUnspentByClassLockStmt = this.db.prepare("".concat(getAllUnspentSql, " AND jig.class = ? AND lock = ?"));
        this.getAllUnspentByClassScripthashStmt = this.db.prepare("".concat(getAllUnspentSql, " AND jig.class = ? AND scripthash = ?"));
        this.getAllUnspentByLockScripthashStmt = this.db.prepare("".concat(getAllUnspentSql, " AND jig.lock = ? AND scripthash = ?"));
        this.getAllUnspentByClassLockScripthashStmt = this.db.prepare("".concat(getAllUnspentSql, " AND jig.class = ? AND jig.lock = ? AND scripthash = ?"));
        this.getNumUnspentStmt = this.db.prepare('SELECT COUNT(*) as unspent FROM spends JOIN jig ON spends.location = jig.location WHERE spends.spend_txid IS NULL');
        this.setBerryStateStmt = this.db.prepare('INSERT OR IGNORE INTO berry (location, state) VALUES (?, ?)');
        this.getBerryStateStmt = this.db.prepare('SELECT state FROM berry WHERE location = ?');
        this.deleteBerryStatesStmt = this.db.prepare('DELETE FROM berry WHERE location LIKE ? || \'%\'');
        this.setTrustedStmt = this.db.prepare('INSERT OR REPLACE INTO trust (txid, value) VALUES (?, ?)');
        this.getTrustlistStmt = this.db.prepare('SELECT txid FROM trust WHERE value = 1');
        this.isTrustedStmt = this.db.prepare('SELECT COUNT(*) FROM trust WHERE txid = ? AND value = 1');
        this.banStmt = this.db.prepare('INSERT OR REPLACE INTO ban (txid) VALUES (?)');
        this.unbanStmt = this.db.prepare('DELETE FROM ban WHERE txid = ?');
        this.isBannedStmt = this.db.prepare('SELECT COUNT(*) FROM ban WHERE txid = ?');
        this.getBanlistStmt = this.db.prepare('SELECT txid FROM ban');
        this.getHeightStmt = this.db.prepare('SELECT value FROM crawl WHERE key = \'height\'');
        this.getHashStmt = this.db.prepare('SELECT value FROM crawl WHERE key = \'hash\'');
        this.setHeightStmt = this.db.prepare('UPDATE crawl SET value = ? WHERE key = \'height\'');
        this.setHashStmt = this.db.prepare('UPDATE crawl SET value = ? WHERE key = \'hash\'');
        this.markExecutingStmt = this.db.prepare('INSERT OR IGNORE INTO executing (txid) VALUES (?)');
        this.unmarkExecutingStmt = this.db.prepare('DELETE FROM executing WHERE txid = ?');
    };
    Database.prototype.initializeV1 = function () {
        var _this = this;
        if (this.db.pragma('user_version')[0].user_version !== 0)
            return;
        this.logger.info('Setting up database v1');
        this.transaction(function () {
            _this.db.pragma('user_version = 1');
            _this.db.prepare("CREATE TABLE IF NOT EXISTS tx (\n          txid TEXT NOT NULL,\n          height INTEGER,\n          time INTEGER,\n          hex TEXT,\n          has_code INTEGER,\n          executable INTEGER,\n          executed INTEGER,\n          indexed INTEGER,\n          UNIQUE(txid)\n        )").run();
            _this.db.prepare("CREATE TABLE IF NOT EXISTS spends (\n          location TEXT NOT NULL PRIMARY KEY,\n          spend_txid TEXT\n        ) WITHOUT ROWID").run();
            _this.db.prepare("CREATE TABLE IF NOT EXISTS deps (\n          up TEXT NOT NULL,\n          down TEXT NOT NULL,\n          UNIQUE(up, down)\n        )").run();
            _this.db.prepare("CREATE TABLE IF NOT EXISTS jig (\n          location TEXT NOT NULL PRIMARY KEY,\n          state TEXT NOT NULL,\n          class TEXT,\n          scripthash TEXT,\n          lock TEXT\n        ) WITHOUT ROWID").run();
            _this.db.prepare("CREATE TABLE IF NOT EXISTS berry (\n          location TEXT NOT NULL PRIMARY KEY,\n          state TEXT NOT NULL\n        ) WITHOUT ROWID").run();
            _this.db.prepare("CREATE TABLE IF NOT EXISTS trust (\n          txid TEXT NOT NULL PRIMARY KEY,\n          value INTEGER\n        ) WITHOUT ROWID").run();
            _this.db.prepare("CREATE TABLE IF NOT EXISTS ban (\n          txid TEXT NOT NULL PRIMARY KEY\n        ) WITHOUT ROWID").run();
            _this.db.prepare("CREATE TABLE IF NOT EXISTS crawl (\n          role TEXT UNIQUE,\n          height INTEGER,\n          hash TEXT\n        )").run();
            _this.db.prepare('CREATE INDEX IF NOT EXISTS tx_txid_index ON tx (txid)').run();
            _this.db.prepare('CREATE INDEX IF NOT EXISTS jig_index ON jig (class)').run();
            _this.db.prepare('INSERT OR IGNORE INTO crawl (role, height, hash) VALUES (\'tip\', 0, NULL)').run();
        });
    };
    Database.prototype.initializeV2 = function () {
        var _this = this;
        if (this.db.pragma('user_version')[0].user_version !== 1)
            return;
        this.logger.info('Setting up database v2');
        this.transaction(function () {
            _this.db.pragma('user_version = 2');
            _this.db.prepare("CREATE TABLE tx_v2 (\n          txid TEXT NOT NULL,\n          height INTEGER,\n          time INTEGER,\n          bytes BLOB,\n          has_code INTEGER,\n          executable INTEGER,\n          executed INTEGER,\n          indexed INTEGER\n        )").run();
            var txids = _this.db.prepare('SELECT txid FROM tx').all().map(function (row) { return row.txid; });
            var gettx = _this.db.prepare('SELECT * FROM tx WHERE txid = ?');
            var insert = _this.db.prepare('INSERT INTO tx_v2 (txid, height, time, bytes, has_code, executable, executed, indexed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
            _this.logger.info('Migrating data');
            for (var _i = 0, txids_1 = txids; _i < txids_1.length; _i++) {
                var txid = txids_1[_i];
                var row = gettx.get(txid);
                var bytes = row.hex ? Buffer.from(row.hex, 'hex') : null;
                insert.run(row.txid, row.height, row.time, bytes, row.has_code, row.executable, row.executed, row.indexed);
            }
            _this.db.prepare('DROP INDEX tx_txid_index').run();
            _this.db.prepare('DROP TABLE tx').run();
            _this.db.prepare('ALTER TABLE tx_v2 RENAME TO tx').run();
            _this.db.prepare('CREATE INDEX IF NOT EXISTS tx_txid_index ON tx (txid)').run();
            _this.logger.info('Saving results');
        });
        this.logger.info('Optimizing database');
        this.db.prepare('VACUUM').run();
    };
    Database.prototype.initializeV3 = function () {
        var _this = this;
        if (this.db.pragma('user_version')[0].user_version !== 2)
            return;
        this.logger.info('Setting up database v3');
        this.transaction(function () {
            _this.db.pragma('user_version = 3');
            _this.db.prepare('CREATE INDEX IF NOT EXISTS deps_up_index ON deps (up)').run();
            _this.db.prepare('CREATE INDEX IF NOT EXISTS deps_down_index ON deps (down)').run();
            _this.db.prepare('CREATE INDEX IF NOT EXISTS trust_txid_index ON trust (txid)').run();
            _this.logger.info('Saving results');
        });
    };
    Database.prototype.initializeV4 = function () {
        var _this = this;
        if (this.db.pragma('user_version')[0].user_version !== 3)
            return;
        this.logger.info('Setting up database v4');
        this.transaction(function () {
            _this.db.pragma('user_version = 4');
            _this.db.prepare('ALTER TABLE tx ADD COLUMN downloaded INTEGER GENERATED ALWAYS AS (bytes IS NOT NULL) VIRTUAL').run();
            _this.db.prepare('CREATE INDEX IF NOT EXISTS tx_downloaded_index ON tx (downloaded)').run();
            _this.logger.info('Saving results');
        });
    };
    Database.prototype.initializeV5 = function () {
        var _this = this;
        if (this.db.pragma('user_version')[0].user_version !== 4)
            return;
        this.logger.info('Setting up database v5');
        this.transaction(function () {
            _this.db.pragma('user_version = 5');
            _this.db.prepare('CREATE INDEX IF NOT EXISTS ban_txid_index ON ban (txid)').run();
            _this.db.prepare('CREATE INDEX IF NOT EXISTS tx_height_index ON tx (height)').run();
            _this.logger.info('Saving results');
        });
    };
    Database.prototype.initializeV6 = function () {
        var _this = this;
        if (this.db.pragma('user_version')[0].user_version !== 5)
            return;
        this.logger.info('Setting up database v6');
        this.transaction(function () {
            _this.db.pragma('user_version = 6');
            var height = _this.db.prepare('SELECT height FROM crawl WHERE role = \'tip\'').raw(true).all()[0];
            var hash = _this.db.prepare('SELECT hash FROM crawl WHERE role = \'tip\'').raw(true).all()[0];
            _this.db.prepare('DROP TABLE crawl').run();
            _this.db.prepare("CREATE TABLE IF NOT EXISTS crawl (\n          key TEXT UNIQUE,\n          value TEXT\n        )").run();
            _this.db.prepare('INSERT INTO crawl (key, value) VALUES (\'height\', ?)').run(height.toString());
            _this.db.prepare('INSERT INTO crawl (key, value) VALUES (\'hash\', ?)').run(hash);
            _this.logger.info('Saving results');
        });
    };
    Database.prototype.initializeV7 = function () {
        var _this = this;
        if (this.db.pragma('user_version')[0].user_version !== 6)
            return;
        this.logger.info('Setting up database v7');
        this.transaction(function () {
            _this.db.pragma('user_version = 7');
            _this.logger.info('Getting possible transactions to execute');
            var stmt = _this.db.prepare("\n          SELECT txid\n          FROM tx \n          WHERE downloaded = 1\n          AND executable = 1\n          AND executed = 0\n          AND (has_code = 0 OR (SELECT COUNT(*) FROM trust WHERE trust.txid = tx.txid AND trust.value = 1) = 1)\n          AND txid NOT IN ban\n        ");
            var txids = stmt.raw(true).all().map(function (x) { return x[0]; });
            var isReadyToExecuteStmt = _this.db.prepare(IS_READY_TO_EXECUTE_SQL);
            var ready = [];
            for (var i = 0; i < txids.length; i++) {
                var txid = txids[i];
                var row = isReadyToExecuteStmt.get(txid);
                if (row && row.ready)
                    ready.push(txid);
                if (i % 1000 === 0)
                    console.log('Checking to execute', i, 'of', txids.length);
            }
            _this.logger.info('Marking', ready.length, 'transactions to execute');
            _this.db.prepare('CREATE TABLE IF NOT EXISTS executing (txid TEXT UNIQUE)').run();
            var markExecutingStmt = _this.db.prepare('INSERT OR IGNORE INTO executing (txid) VALUES (?)');
            ready.forEach(function (txid) { return markExecutingStmt.run(txid); });
            _this.logger.info('Saving results');
        });
    };
    Database.prototype.close = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!this.worker) return [3 /*break*/, 2];
                        this.logger.debug('Terminating background loader');
                        return [4 /*yield*/, this.worker.terminate()];
                    case 1:
                        _a.sent();
                        this.worker = null;
                        _a.label = 2;
                    case 2:
                        if (this.db) {
                            this.logger.debug('Closing' + (this.readonly ? ' readonly' : '') + ' database');
                            this.db.close();
                            this.db = null;
                        }
                        return [2 /*return*/];
                }
            });
        });
    };
    Database.prototype.transaction = function (f) {
        if (!this.db)
            return;
        this.db.transaction(f)();
    };
    // --------------------------------------------------------------------------
    // tx
    // --------------------------------------------------------------------------
    Database.prototype.addBlock = function (txids, txhexs, height, hash, time) {
        var _this = this;
        this.transaction(function () {
            txids.forEach(function (txid, i) {
                var txhex = txhexs && txhexs[i];
                _this.addTransaction(txid, txhex, height, time);
            });
            _this.setHeight(height);
            _this.setHash(hash);
        });
    };
    Database.prototype.addTransaction = function (txid, txhex, height, time) {
        var _this = this;
        this.transaction(function () {
            _this.addNewTransaction(txid);
            if (height)
                _this.setTransactionHeight(txid, height);
            if (time)
                _this.setTransactionTime(txid, time);
        });
        var downloaded = this.isTransactionDownloaded(txid);
        if (downloaded)
            return;
        if (txhex) {
            this.parseAndStoreTransaction(txid, txhex);
        }
        else {
            if (this.onRequestDownload)
                this.onRequestDownload(txid);
        }
    };
    Database.prototype.parseAndStoreTransaction = function (txid, hex) {
        if (this.isTransactionDownloaded(txid))
            return;
        var metadata = null;
        var bsvtx = null;
        var inputs = [];
        var outputs = [];
        try {
            if (!hex)
                throw new Error('No hex');
            bsvtx = new bsv.Transaction(hex);
            bsvtx.inputs.forEach(function (input) {
                var location = "".concat(input.prevTxId.toString('hex'), "_o").concat(input.outputIndex);
                inputs.push(location);
            });
            bsvtx.outputs.forEach(function (output, n) {
                if (output.script.isDataOut() || output.script.isSafeDataOut())
                    return;
                outputs.push("".concat(txid, "_o").concat(n));
            });
            metadata = Run.util.metadata(hex);
        }
        catch (e) {
            this.logger.error("".concat(txid, " => ").concat(e.message));
            this.storeParsedNonExecutableTransaction(txid, hex, inputs, outputs);
            return;
        }
        var deps = new Set();
        for (var i = 0; i < metadata.in; i++) {
            var prevtxid = bsvtx.inputs[i].prevTxId.toString('hex');
            deps.add(prevtxid);
        }
        for (var _i = 0, _a = metadata.ref; _i < _a.length; _i++) {
            var ref = _a[_i];
            if (ref.startsWith('native://')) {
                continue;
            }
            else if (ref.includes('berry')) {
                var reftxid = ref.slice(0, 64);
                deps.add(reftxid);
            }
            else {
                var reftxid = ref.slice(0, 64);
                deps.add(reftxid);
            }
        }
        var hasCode = metadata.exec.some(function (cmd) { return cmd.op === 'DEPLOY' || cmd.op === 'UPGRADE'; });
        this.storeParsedExecutableTransaction(txid, hex, hasCode, deps, inputs, outputs);
        //@ts-ignore
        for (var _b = 0, deps_1 = deps; _b < deps_1.length; _b++) {
            var deptxid = deps_1[_b];
            if (!this.isTransactionDownloaded(deptxid)) {
                if (this.onRequestDownload)
                    this.onRequestDownload(deptxid);
            }
        }
    };
    Database.prototype.addNewTransaction = function (txid) {
        if (this.hasTransaction(txid))
            return;
        var time = Math.round(Date.now() / 1000);
        this.addNewTransactionStmt.run(txid, time);
        if (this.onAddTransaction)
            this.onAddTransaction(txid);
    };
    Database.prototype.setTransactionHeight = function (txid, height) {
        this.setTransactionHeightStmt.run(height, txid);
    };
    Database.prototype.setTransactionTime = function (txid, time) {
        this.setTransactionTimeStmt.run(time, txid);
    };
    Database.prototype.storeParsedNonExecutableTransaction = function (txid, hex, inputs, outputs) {
        var _this = this;
        this.transaction(function () {
            var bytes = Buffer.from(hex, 'hex');
            _this.setTransactionBytesStmt.run(bytes, txid);
            _this.setTransactionExecutableStmt.run(0, txid);
            inputs.forEach(function (location) { return _this.setSpendStmt.run(location, txid); });
            outputs.forEach(function (location) { return _this.setUnspentStmt.run(location); });
        });
        // Non-executable might be berry data. We execute once we receive them.
        var downstreamReadyToExecute = this.getDownstreamReadyToExecuteStmt.raw(true).all(txid).map(function (x) { return x[0]; });
        downstreamReadyToExecute.forEach(function (downtxid) {
            _this.markExecutingStmt.run(downtxid);
            if (_this.onReadyToExecute)
                _this.onReadyToExecute(downtxid);
        });
    };
    Database.prototype.storeParsedExecutableTransaction = function (txid, hex, hasCode, deps, inputs, outputs) {
        var _this = this;
        this.transaction(function () {
            var bytes = Buffer.from(hex, 'hex');
            _this.setTransactionBytesStmt.run(bytes, txid);
            _this.setTransactionExecutableStmt.run(1, txid);
            _this.setTransactionHasCodeStmt.run(hasCode ? 1 : 0, txid);
            inputs.forEach(function (location) { return _this.setSpendStmt.run(location, txid); });
            outputs.forEach(function (location) { return _this.setUnspentStmt.run(location); });
            for (var _i = 0, deps_2 = deps; _i < deps_2.length; _i++) {
                var deptxid = deps_2[_i];
                _this.addNewTransaction(deptxid);
                _this.addDepStmt.run(deptxid, txid);
                if (_this.getTransactionFailedStmt.get(deptxid).failed) {
                    _this.setTransactionExecutionFailed(txid);
                    return;
                }
            }
        });
        this._checkExecutability(txid);
    };
    //onUntrustTransaction(txid: string): void {}
    Database.prototype.storeExecutedTransaction = function (txid, result) {
        var _this = this;
        var cache = result.cache, classes = result.classes, locks = result.locks, scripthashes = result.scripthashes;
        this.transaction(function () {
            _this.setTransactionExecutedStmt.run(1, txid);
            _this.setTransactionIndexedStmt.run(1, txid);
            _this.unmarkExecutingStmt.run(txid);
            for (var _i = 0, _a = Object.keys(cache); _i < _a.length; _i++) {
                var key = _a[_i];
                if (key.startsWith('jig://')) {
                    var location_1 = key.slice('jig://'.length);
                    _this.setJigStateStmt.run(location_1, JSON.stringify(cache[key]));
                    continue;
                }
                if (key.startsWith('berry://')) {
                    var location_2 = key.slice('berry://'.length);
                    _this.setBerryStateStmt.run(location_2, JSON.stringify(cache[key]));
                    continue;
                }
            }
            for (var _b = 0, classes_1 = classes; _b < classes_1.length; _b++) {
                var _c = classes_1[_b], location_3 = _c[0], cls = _c[1];
                _this.setJigClassStmt.run(cls, location_3);
            }
            for (var _d = 0, locks_1 = locks; _d < locks_1.length; _d++) {
                var _e = locks_1[_d], location_4 = _e[0], lock = _e[1];
                _this.setJigLockStmt.run(lock, location_4);
            }
            for (var _f = 0, scripthashes_1 = scripthashes; _f < scripthashes_1.length; _f++) {
                var _g = scripthashes_1[_f], location_5 = _g[0], scripthash = _g[1];
                _this.setJigScripthashStmt.run(scripthash, location_5);
            }
        });
        var downstreamReadyToExecute = this.getDownstreamReadyToExecuteStmt.raw(true).all(txid).map(function (x) { return x[0]; });
        downstreamReadyToExecute.forEach(function (downtxid) {
            _this.markExecutingStmt.run(downtxid);
            if (_this.onReadyToExecute)
                _this.onReadyToExecute(downtxid);
        });
    };
    Database.prototype.setTransactionExecutionFailed = function (txid) {
        var _this = this;
        this.transaction(function () {
            _this.setTransactionExecutableStmt.run(0, txid);
            _this.setTransactionExecutedStmt.run(1, txid);
            _this.setTransactionIndexedStmt.run(0, txid);
            _this.unmarkExecutingStmt.run(txid);
        });
        // We try executing downstream transactions if this was marked executable but it wasn't.
        // This allows an admin to manually change executable status in the database.
        var executable = false;
        try {
            var rawtx = this.getTransactionHex(txid);
            Run.util.metadata(rawtx);
            executable = true;
        }
        catch (e) { }
        if (!executable) {
            var downstream = this.getDownstreamStmt.raw(true).all(txid).map(function (x) { return x[0]; });
            downstream.forEach(function (downtxid) { return _this._checkExecutability(downtxid); });
        }
    };
    Database.prototype.getTransactionHex = function (txid) {
        var row = this.getTransactionHexStmt.raw(true).get(txid);
        return row && row[0];
    };
    Database.prototype.getTransactionTime = function (txid) {
        var row = this.getTransactionTimeStmt.raw(true).get(txid);
        return row && row[0];
    };
    Database.prototype.getTransactionHeight = function (txid) {
        var row = this.getTransactionHeightStmt.raw(true).get(txid);
        return row && row[0];
    };
    Database.prototype.deleteTransaction = function (txid, deleted) {
        var _this = this;
        if (deleted === void 0) { deleted = new Set(); }
        if (deleted.has(txid))
            return;
        var txids = [txid];
        deleted.add(txid);
        this.transaction(function () {
            while (txids.length) {
                var txid_1 = txids.shift();
                if (_this.onDeleteTransaction)
                    _this.onDeleteTransaction(txid_1);
                _this.deleteTransactionStmt.run(txid_1);
                _this.deleteJigStatesStmt.run(txid_1);
                _this.deleteBerryStatesStmt.run(txid_1);
                _this.deleteSpendsStmt.run(txid_1);
                _this.unspendOutputsStmt.run(txid_1);
                _this.deleteDepsStmt.run(txid_1);
                var downtxids = _this.getDownstreamStmt.raw(true).all(txid_1).map(function (row) { return row[0]; });
                for (var _i = 0, downtxids_1 = downtxids; _i < downtxids_1.length; _i++) {
                    var downtxid = downtxids_1[_i];
                    if (deleted.has(downtxid))
                        continue;
                    deleted.add(downtxid);
                    txids.push(downtxid);
                }
            }
        });
    };
    Database.prototype.unconfirmTransaction = function (txid) {
        this.unconfirmTransactionStmt.run(txid);
    };
    Database.prototype.unindexTransaction = function (txid) {
        var _this = this;
        this.transaction(function () {
            if (_this.getTransactionIndexedStmt.raw(true).get(txid)[0]) {
                _this.setTransactionExecutedStmt.run(0, txid);
                _this.setTransactionIndexedStmt.run(0, txid);
                _this.deleteJigStatesStmt.run(txid);
                _this.deleteBerryStatesStmt.run(txid);
                _this.unmarkExecutingStmt.run(txid);
                var downtxids = _this.getDownstreamStmt.raw(true).all(txid).map(function (row) { return row[0]; });
                downtxids.forEach(function (downtxid) { return _this.unindexTransaction(downtxid); });
                if (_this.onUnindexTransaction)
                    _this.onUnindexTransaction(txid);
            }
        });
    };
    Database.prototype.hasTransaction = function (txid) { return !!this.hasTransactionStmt.get(txid); };
    Database.prototype.isTransactionDownloaded = function (txid) {
        var result = this.getTransactionDownloadedStmt.raw(true).get(txid);
        return result && !!result[0];
    };
    Database.prototype.getTransactionsAboveHeight = function (height) { return this.getTransactionsAboveHeightStmt.raw(true).all(height).map(function (row) { return row[0]; }); };
    Database.prototype.getMempoolTransactionsBeforeTime = function (time) { return this.getMempoolTransactionsBeforeTimeStmt.raw(true).all(time).map(function (row) { return row[0]; }); };
    Database.prototype.getTransactionsToDownload = function () { return this.getTransactionsToDownloadStmt.raw(true).all().map(function (row) { return row[0]; }); };
    Database.prototype.getDownloadedCount = function () { return this.getTransactionsDownloadedCountStmt.get().count; };
    Database.prototype.getIndexedCount = function () { return this.getTransactionsIndexedCountStmt.get().count; };
    // --------------------------------------------------------------------------
    // spends
    // --------------------------------------------------------------------------
    Database.prototype.getSpend = function (location) {
        var row = this.getSpendStmt.raw(true).get(location);
        return row && row[0];
    };
    // --------------------------------------------------------------------------
    // deps
    // --------------------------------------------------------------------------
    Database.prototype.addDep = function (txid, deptxid) {
        this.addNewTransaction(deptxid);
        this.addDepStmt.run(deptxid, txid);
        if (this.getTransactionFailedStmt.get(deptxid).failed) {
            this.setTransactionExecutionFailed(deptxid);
        }
    };
    Database.prototype.addMissingDeps = function (txid, deptxids) {
        var _this = this;
        this.transaction(function () { return deptxids.forEach(function (deptxid) { return _this.addDep(txid, deptxid); }); });
        this._checkExecutability(txid);
    };
    // --------------------------------------------------------------------------
    // jig
    // --------------------------------------------------------------------------
    Database.prototype.getJigState = function (location) {
        var row = this.getJigStateStmt.raw(true).get(location);
        return row && row[0];
    };
    // --------------------------------------------------------------------------
    // unspent
    // --------------------------------------------------------------------------
    Database.prototype.getAllUnspent = function () {
        return this.getAllUnspentStmt.raw(true).all().map(function (row) { return row[0]; });
    };
    Database.prototype.getAllUnspentByClassOrigin = function (origin) {
        return this.getAllUnspentByClassStmt.raw(true).all(origin).map(function (row) { return row[0]; });
    };
    Database.prototype.getAllUnspentByLockOrigin = function (origin) {
        return this.getAllUnspentByLockStmt.raw(true).all(origin).map(function (row) { return row[0]; });
    };
    Database.prototype.getAllUnspentByScripthash = function (scripthash) {
        return this.getAllUnspentByScripthashStmt.raw(true).all(scripthash).map(function (row) { return row[0]; });
    };
    Database.prototype.getAllUnspentByClassOriginAndLockOrigin = function (clsOrigin, lockOrigin) {
        return this.getAllUnspentByClassLockStmt.raw(true).all(clsOrigin, lockOrigin).map(function (row) { return row[0]; });
    };
    Database.prototype.getAllUnspentByClassOriginAndScripthash = function (clsOrigin, scripthash) {
        return this.getAllUnspentByClassScripthashStmt.raw(true).all(clsOrigin, scripthash).map(function (row) { return row[0]; });
    };
    Database.prototype.getAllUnspentByLockOriginAndScripthash = function (lockOrigin, scripthash) {
        return this.getAllUnspentByLockScripthashStmt.raw(true).all(lockOrigin, scripthash).map(function (row) { return row[0]; });
    };
    Database.prototype.getAllUnspentByClassOriginAndLockOriginAndScripthash = function (clsOrigin, lockOrigin, scripthash) {
        return this.getAllUnspentByClassLockScripthashStmt.raw(true).all(clsOrigin, lockOrigin, scripthash).map(function (row) { return row[0]; });
    };
    Database.prototype.getNumUnspent = function () {
        return this.getNumUnspentStmt.get().unspent;
    };
    // --------------------------------------------------------------------------
    // berry
    // --------------------------------------------------------------------------
    Database.prototype.getBerryState = function (location) {
        var row = this.getBerryStateStmt.raw(true).get(location);
        return row && row[0];
    };
    // --------------------------------------------------------------------------
    // trust
    // --------------------------------------------------------------------------
    Database.prototype.isTrusted = function (txid) {
        var row = this.isTrustedStmt.raw(true).get(txid);
        return !!row && !!row[0];
    };
    Database.prototype.trust = function (txid) {
        var _this = this;
        if (this.isTrusted(txid))
            return;
        var trusted = [txid];
        // Recursively trust code parents
        var queue = this.getUpstreamUnexecutedCodeStmt.raw(true).all(txid).map(function (x) { return x[0]; });
        var visited = new Set();
        while (queue.length) {
            var uptxid = queue.shift();
            if (visited.has(uptxid))
                continue;
            if (this.isTrusted(uptxid))
                continue;
            visited.add(uptxid);
            trusted.push(txid);
            this.getUpstreamUnexecutedCodeStmt.raw(true).all(txid).forEach(function (x) { return queue.push(x[0]); });
        }
        this.transaction(function () { return trusted.forEach(function (txid) { return _this.setTrustedStmt.run(txid, 1); }); });
        trusted.forEach(function (txid) { return _this._checkExecutability(txid); });
        if (this.onTrustTransaction)
            trusted.forEach(function (txid) { return _this.onTrustTransaction(txid); });
    };
    Database.prototype.untrust = function (txid) {
        var _this = this;
        if (!this.isTrusted(txid))
            return;
        this.transaction(function () {
            _this.unindexTransaction(txid);
            _this.setTrustedStmt.run(txid, 0);
        });
        if (this.onUntrustTransaction)
            this.onUntrustTransaction(txid);
    };
    Database.prototype.getTrustlist = function () {
        return this.getTrustlistStmt.raw(true).all().map(function (x) { return x[0]; });
    };
    // --------------------------------------------------------------------------
    // ban
    // --------------------------------------------------------------------------
    Database.prototype.isBanned = function (txid) {
        var row = this.isBannedStmt.raw(true).get(txid);
        return !!row && !!row[0];
    };
    Database.prototype.ban = function (txid) {
        var _this = this;
        this.transaction(function () {
            _this.unindexTransaction(txid);
            _this.banStmt.run(txid);
        });
        if (this.onBanTransaction)
            this.onBanTransaction(txid);
    };
    Database.prototype.unban = function (txid) {
        this.unbanStmt.run(txid);
        this._checkExecutability(txid);
        if (this.onUnbanTransaction)
            this.onUnbanTransaction(txid);
    };
    Database.prototype.getBanlist = function () {
        return this.getBanlistStmt.raw(true).all().map(function (x) { return x[0]; });
    };
    // --------------------------------------------------------------------------
    // crawl
    // --------------------------------------------------------------------------
    Database.prototype.getHeight = function () {
        var row = this.getHeightStmt.raw(true).all()[0];
        return row && parseInt(row[0]);
    };
    Database.prototype.getHash = function () {
        var row = this.getHashStmt.raw(true).all()[0];
        return row && row[0];
    };
    Database.prototype.setHeight = function (height) {
        this.setHeightStmt.run(height.toString());
    };
    Database.prototype.setHash = function (hash) {
        this.setHashStmt.run(hash);
    };
    Database.prototype.retryTx = function (txid) {
        var _this = this;
        var txids = [txid];
        var missing = new Set(txids);
        this.setTransactionExecutedStmt.run(0, txid);
        this.setTransactionIndexedStmt.run(0, txid);
        while (missing.size > 0) {
            Array.from(missing).forEach(function (txid) {
                var row = _this.isReadyToExecuteStmt.get(txid);
                if (row && row.ready) {
                    missing.delete(txid);
                    if (_this.onReadyToExecute)
                        _this.onReadyToExecute(txid);
                }
                else {
                    _this.unmarkExecutingStmt.run(txid);
                    missing.delete(txid);
                    var depTxids = _this.getUpstreamStmt.raw(true).all(txid).map(function (r) { return r[0]; });
                    depTxids.forEach(function (depTxid) {
                        // Because we are retrying, we execute again failed deps.
                        if (_this.getTransactionFailedStmt.get(depTxid).failed) {
                            _this.setTransactionExecutedStmt.run(0, depTxid);
                            _this.setTransactionIndexedStmt.run(0, depTxid);
                            _this.setTransactionExecutableStmt.run(1, depTxid);
                        }
                        if (_this.getTransactionExecutableStmt.get(depTxid).executable) {
                            missing.add(depTxid);
                            _this.markExecutingStmt.run(depTxid);
                        }
                    });
                }
            });
        }
    };
    // --------------------------------------------------------------------------
    // internal
    // --------------------------------------------------------------------------
    Database.prototype.loadTransactionsToExecute = function () {
        var _this = this;
        this.logger.debug('Loading transactions to execute');
        var txids = this.db.prepare('SELECT txid FROM executing').raw(true).all().map(function (x) { return x[0]; });
        txids.forEach(function (txid) { return _this._checkExecutability(txid); });
    };
    Database.prototype._checkExecutability = function (txid) {
        var row = this.isReadyToExecuteStmt.get(txid);
        if (row && row.ready) {
            this.markExecutingStmt.run(txid);
            if (this.onReadyToExecute)
                this.onReadyToExecute(txid);
        }
    };
    Database.HEIGHT_MEMPOOL = -1;
    return Database;
}());
exports.default = Database;
// ------------------------------------------------------------------------------------------------
