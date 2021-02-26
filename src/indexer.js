/**
 * index.js
 *
 * Indexer API
 */

const Run = require('run-sdk')
const bsv = require('bsv')
const Database = require('./database')
const Downloader = require('./downloader')
const Executor = require('./executor')
const Crawler = require('./crawler')

// ------------------------------------------------------------------------------------------------
// Indexer
// ------------------------------------------------------------------------------------------------

class Indexer {
  constructor (db, api, network, numParallelDownloads, numParallelExecutes, logger, startHeight) {
    this.logger = logger || {}
    this.logger.info = this.logger.info || (() => {})
    this.logger.warn = this.logger.warn || (() => {})
    this.logger.error = this.logger.error || (() => {})
    this.logger.debug = this.logger.debug || (() => {})

    this.onIndex = null
    this.onFailToIndex = null
    this.onBlock = null
    this.onReorg = null

    this.api = api
    this.network = network
    this.startHeight = startHeight

    const fetchFunction = this.api.fetch ? this.api.fetch.bind(this.api) : null

    this.database = new Database(db)
    this.downloader = new Downloader(fetchFunction, numParallelDownloads)
    this.executor = new Executor(network, numParallelExecutes)
    this.crawler = new Crawler(api)

    this.downloader.onDownloadTransaction = this._onDownloadTransaction.bind(this)
    this.downloader.onFailedToDownloadTransaction = this._onFailedToDownloadTransaction.bind(this)
    this.downloader.onRetryingDownload = this._onRetryingDownload.bind(this)
    this.executor.onCacheGet = this._onCacheGet.bind(this)
    this.executor.onBlockchainFetch = this._onBlockchainFetch.bind(this)
    this.executor.onTrustlistGet = this._onTrustlistGet.bind(this)
    this.executor.onIndexed = this._onIndexed.bind(this)
    this.executor.onExecuteFailed = this._onExecuteFailed.bind(this)
    this.executor.onMissingDeps = this._onMissingDeps.bind(this)
    this.crawler.onCrawlError = this._onCrawlError.bind(this)
    this.crawler.onCrawlBlockTransactions = this._onCrawlBlockTransactions.bind(this)
    this.crawler.onRewindBlocks = this._onRewindBlocks.bind(this)
    this.crawler.onMempoolTransaction = this._onMempoolTransaction.bind(this)
  }

  async start () {
    this.database.open()
    this.executor.start()
    const height = this.database.getHeight() || this.startHeight
    const hash = this.database.getHash()
    if (this.api.connect) await this.api.connect(height, this.network)
    this.database.getTransactionsToDownload().forEach(txid => this.downloader.add(txid))
    this.database.getTransactionsToExecute().forEach(txid => console.log(txid))
    console.log(this.database.getRemainingToExecute())
    this.crawler.start(height, hash)
  }

  async stop () {
    this.crawler.stop()
    if (this.api.disconnect) await this.api.disconnect()
    this.downloader.stop()
    this.database.close()
    await this.executor.stop()
  }

  add (txid, hex = null, height = null) {
    if (!/[0-9a-f]{64}/.test(txid)) throw new Error('Not a txid: ' + txid)
    this._addTransactions([txid], [hex], height)
  }

  remove (txid) {
    /*
    if (!/[0-9a-f]{64}/.test(txid)) throw new Error('Not a txid: ' + txid)
    this.logger.info('Removing', txid)
    this.downloader.remove(txid)
    this.graph.remove(txid
    this.database.deleteTransaction(txid)
    this.database.deleteJigStates(txid)
    this.database.deleteBerryStates(txid)
    */
  }

  jig (location) {
    return this.database.getJigState(location)
  }

  berry (location) {
    return this.database.getBerryState(location)
  }

  tx (txid) {
    return this.database.getTransactionHex(txid)
  }

  trust (txid) {
    /*
    txid = txid.trim().toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(txid)) throw new Error('Not a txid: ' + txid)
    this.logger.info('Trusting', txid)
    this.database.setTrusted(txid, 1)
    this.graph.onTrust(txid)
    */
  }

  untrust (txid) {
    /*
    this.logger.info('Untrusting', txid)
    this.graph.onUntrust(txid)
    this.database.setTrusted(txid, false)
    */
  }

  untrusted (txid) {
    /*
    if (!txid) {
      return Array.from(this.graph.untrusted)
    }

    const untrusted = new Set()
    const queue = [txid]
    while (queue.length) {
      const next = queue.shift()
      if (this.graph.untrusted.has(next)) untrusted.add(next)
      const upstreamUnexecuted = this.getUpstreamUnexecuted(txid)
      upstreamUnexecuted.forEach(txid => queue.push(txid))
    }
    return Array.from(untrusted)
    */
  }

  status () {
    return {
      height: this.crawler.height,
      hash: this.crawler.hash,
      indexed: this.database.getIndexedCount(),
      downloaded: this.database.getDownloadedCount(),
      downloading: this.downloader.remaining()
      // executing: this.graph.remaining.size
    }
  }

  _onDownloadTransaction (txid, hex) {
    this.logger.info(`Downloaded ${txid} (${this.downloader.remaining()} remaining)`)
    this._parseAndStoreTransaction(txid, hex)
  }

  _onFailedToDownloadTransaction (txid, e) {
    this.logger.error('Failed to download', txid, e.toString())
  }

  _onRetryingDownload (txid, secondsToRetry) {
    this.logger.info('Retrying download', txid, 'after', secondsToRetry, 'seconds')
  }

  _onReadyToExecute (txid) {
    /*
    const hex = this.database.getTransactionHex(txid)
    this.executor.execute(txid, hex)
    */
  }

  _onCacheGet (key) {
    if (key.startsWith('jig://')) {
      const state = this.database.getJigState(key.slice('jig://'.length))
      if (state) return JSON.parse(state)
    }
    if (key.startsWith('berry://')) {
      const state = this.database.getBerryState(key.slice('berry://'.length))
      if (state) return JSON.parse(state)
    }
    if (key.startsWith('tx://')) {
      return this.database.getTransactionHex(key.slice('tx://'.length))
    }
  }

  _onBlockchainFetch (txid) {
    const hex = this.database.getTransactionHex(txid)
    if (!hex) throw new Error(`Not found: ${txid}`)
    return hex
  }

  _onTrustlistGet () {
    return this.database.getTrustlist()
  }

  _onIndexed (txid, state) {
    /*
    // Check that the tx is still in our graph (ie. not re-orged)
    if (!this.database.hasTransaction(txid)) return

    this.logger.info(`Executed ${txid} (${this.graph.remaining.size - 1} remaining)`)

    this.database.transaction(() => {
      this.database.setTransactionExecuted(txid, true)
      this.database.setTransactionIndexed(txid, true)

      for (const key of Object.keys(state)) {
        if (key.startsWith('jig://')) {
          const location = key.slice('jig://'.length)
          this.database.setJigState(location, JSON.stringify(state[key]))
          continue
        }

        if (key.startsWith('berry://')) {
          const location = key.slice('berry://'.length)
          this.database.setBerryState(location, JSON.stringify(state[key]))
          continue
        }
      }
    })

    this.graph.onExecuted(txid)

    if (this.onIndex) this.onIndex(txid)
    */
  }

  _onExecuteFailed (txid, e) {
    /*
    this.logger.error(`Failed to execute ${txid}: ${e.toString()}`)

    this.database.transaction(() => {
      this.database.setTransactionExecuted(txid, true)
      this.database.setTransactionIndexed(txid, false)
    })

    this.graph.onExecuted(txid)

    if (this.onFailToIndex) this.onFailToIndex(txid, e)
    */
  }

  _onMissingDeps (txid, deptxids) {
    /*
    this.logger.debug(`Discovered ${deptxids.size} dep(s) for ${txid}`)

    for (const deptxid of deptxids) {
      this.database.addNewTransaction(deptxid, null)
      this.graph.addDep(txid, deptxid)

      const hex = this.database.getTransactionHex(deptxid)

      if (hex) {
        this.graph.onDownloaded(txid)
      } else {
        this.downloader.add(deptxid)
      }
    }
    */
  }

  _onCrawlError (e) {
    this.logger.error(`Crawl error: ${e.toString()}`)
  }

  _onCrawlBlockTransactions (height, hash, txids, txhexs) {
    this.logger.info(`Crawled block ${height} for ${txids.length} transactions`)
    this._addTransactions(txids, txhexs, height)
    this.database.setHeightAndHash(height, hash)
    if (this.onBlock) this.onBlock(height)
  }

  _onRewindBlocks (newHeight) {
    /*
    this.logger.info(`Rewinding to block ${newHeight}`)

    const txids = this.database.getTransactionsAboveHeight(newHeight)

    txids.forEach(txid => {
      this.logger.info('Removing', txid)
      this.downloader.remove(txid)
      this.graph.remove(txid)
    })

    this.database.transaction(() => {
      txids.forEach(txid => {
        this.database.deleteTransaction(txid)
        this.database.deleteJigStates(txid)
        this.database.deleteBerryStates(txid)
      })

      this.database.setHeightAndHash(newHeight, null)
    })

    if (this.onReorg) this.onReorg(newHeight)
    */
  }

  _onMempoolTransaction (txid, hex) {
    // this.add(txid, hex, null)
  }

  _addTransactions (txids, txhexs, height) {
    this.database.transaction(() => {
      txids
        .filter(txid => !this.database.hasTransaction(txid))
        .forEach((txid, i) => {
          this.logger.info('Adding', txid)
          this.database.addNewTransaction(txid, height)
          if (height) this.database.setTransactionHeight(txid, height)
        })

      txids
        .filter(txid => !this.database.isTransactionDownloaded(txid))
        .forEach((txid, i) => {
          const hex = txhexs && txhexs[i]
          if (hex) {
            this._parseAndStoreTransaction(txid, hex)
          } else {
            this.downloader.add(txid)
          }
        })
    })
  }

  _parseAndStoreTransaction (txid, hex) {
    if (this.database.isTransactionDownloaded(txid)) return

    let metadata = null
    let bsvtx = null

    try {
      metadata = Run.util.metadata(hex)
      bsvtx = new bsv.Transaction(hex)
    } catch (e) {
      this.logger.error(`Failed to parse ${txid}: ${e}`)

      this.database.transaction(() => {
        this.database.setTransactionHex(txid, hex)
        this.database.setTransactionExecuted(txid, true)
        this.database.setTransactionIndexed(txid, false)
      })

      // this.onExecuted(txid)
      return
    }

    const deps = new Set()

    for (let i = 0; i < metadata.in; i++) {
      const prevtxid = bsvtx.inputs[i].prevTxId.toString('hex')
      deps.add(prevtxid)
    }

    for (const ref of metadata.ref) {
      if (ref.startsWith('native://')) {
        continue
      } else if (ref.includes('berry')) {
        const reftxid = ref.slice(0, 64)
        deps.add(reftxid)
      } else {
        const reftxid = ref.slice(0, 64)
        deps.add(reftxid)
      }
    }

    const hasCode = metadata.exec.some(cmd => cmd.op === 'DEPLOY' || cmd.op === 'UPGRADE')

    this.database.transaction(() => {
      this.database.setTransactionHex(txid, hex)
      this.database.setTransactionHasCode(txid, hasCode)
      deps.forEach(deptxid => this.database.addDep(deptxid, txid))
    })

    deps.forEach(txid => this.add(txid))
  }
}

// ------------------------------------------------------------------------------------------------

module.exports = Indexer
