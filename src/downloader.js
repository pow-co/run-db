/**
 * downloader.js
 *
 * Downloads transactions
 */

// ------------------------------------------------------------------------------------------------
// Downloader
// ------------------------------------------------------------------------------------------------

interface FetchFunction {
	(txid: string): Promise<string>
}

export default class Downloader {
  constructor (fetchFunction: FetchFunction, numParallelDownloads: number) {
    this.onDownloadTransaction = null
    this.onFailedToDownloadTransaction = null
    this.onRetryingDownload = null

    this.fetchFunction = fetchFunction
    this.numParallelDownloads = numParallelDownloads

    this.queued = new Set() // txid
    this.fetching = new Set() // txid
    this.waitingToRetry = new Set() // txid
    this.attempts = new Map() // txid -> attempts
  }

  stop (): void {
    this.queued = new Set()
    this.fetching = new Set()
    this.waitingToRetry = new Set()
    this.attempts = new Map()
  }

  add (txid: string): void {
    if (this.has(txid)) return
    if (!this.fetchFunction) return

    this._enqueueFetch(txid)
  }

  _enqueueFetch (txid: string): void {
    if (this.fetching.size >= this.numParallelDownloads) {
      this.queued.add(txid)
    } else {
      this._fetch(txid)
    }
  }

  remove (txid: string): void {
    if (!this.has(txid)) return
    this.queued.delete(txid)
    this.fetching.delete(txid)
    this.waitingToRetry.delete(txid)
    this.attempts.delete(txid)
  }

  has (txid: string):boolean {
    return this.queued.has(txid) || this.fetching.has(txid) || this.waitingToRetry.has(txid)
  }

  remaining (): number {
    return this.queued.size + this.fetching.size + this.waitingToRetry.size
  }

  async _fetch (txid: string): Promise<void> {
    this.fetching.add(txid)

    try {
      const { hex, height, time } = await this.fetchFunction(txid)

      this._onFetchSucceed(txid, hex, height, time)
    } catch (e) {
      this._onFetchFailed(txid, e)
    } finally {
      this._fetchNextInQueue()
    }
  }

  _onFetchSucceed (txid: string, hex: string, height: number, time: number): void {
    if (!this.fetching.delete(txid)) return

    this.attempts.delete(txid)

    if (this.onDownloadTransaction) this.onDownloadTransaction(txid, hex, height, time)
  }

  _onFetchFailed (txid: string, e: error): void {
    if (!this.fetching.delete(txid)) return

    if (this.onFailedToDownloadTransaction) this.onFailedToDownloadTransaction(txid, e)

    const attempts = (this.attempts.get(txid) || 0) + 1
    const secondsToRetry = Math.pow(2, attempts)

    if (this.onRetryingDownload) this.onRetryingDownload(txid, secondsToRetry)

    this.attempts.set(txid, attempts)
    this.waitingToRetry.add(txid)

    setTimeout(() => {
      if (this.waitingToRetry.delete(txid)) {
        this._enqueueFetch(txid)
      }
    }, secondsToRetry * 1000)
  }

  _fetchNextInQueue (): void {
    if (!this.queued.size) return

    const txid = this.queued.keys().next().value
    this.queued.delete(txid)

    this._fetch(txid)
  }
}

// ------------------------------------------------------------------------------------------------
