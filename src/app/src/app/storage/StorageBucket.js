const { EventEmitter } = require('events')
const { ipcMain } = require('electron')
const AppDirectory = require('appdirectory')
const pkg = require('../../package.json')
const mkdirp = require('mkdirp')
const path = require('path')
const fs = require('fs-extra')
const writeFileAtomic = require('write-file-atomic')
const { DB_WRITE_DELAY_MS } = require('../../shared/constants')

// Setup
const appDirectory = new AppDirectory({
  appName: pkg.name,
  useRoaming: true
})
const dbPath = appDirectory.userData()
mkdirp.sync(dbPath)

class StorageBucket extends EventEmitter {
  /* ****************************************************************************/
  // Lifecycle
  /* ****************************************************************************/

  constructor (bucketName) {
    super()
    this.__path__ = path.join(dbPath, bucketName + '_db.json')
    this.__writeHold__ = null
    this.__writeLock__ = false
    this.__data__ = undefined
    this.__ipcReplyChannel__ = `storageBucket:${bucketName}:reply`

    this._migrateFrom3v1v3(bucketName)
    this._loadFromDiskSync()

    ipcMain.on(`storageBucket:${bucketName}:setItem`, this._handleIPCSetItem.bind(this))
    ipcMain.on(`storageBucket:${bucketName}:removeItem`, this._handleIPCRemoveItem.bind(this))
    ipcMain.on(`storageBucket:${bucketName}:getItem`, this._handleIPCGetItem.bind(this))
    ipcMain.on(`storageBucket:${bucketName}:allKeys`, this._handleIPCAllKeys.bind(this))
    ipcMain.on(`storageBucket:${bucketName}:allItems`, this._handleIPCAllItems.bind(this))
    ipcMain.on(`storageBucket:${bucketName}:getStats`, this._handleIPCGetStats.bind(this))
    ipcMain.on(`storageBucket:${bucketName}:measurePerformance`, this._handleIPCMeasurePerformance.bind(this))
  }

  checkAwake () { return true }

  /* ****************************************************************************/
  // Migration
  /* ****************************************************************************/

  /**
  * Performs a migration from 3.1.3
  * @param bucketName: the name of the bucket
  */
  _migrateFrom3v1v3 (bucketName) {
    try {
      if (parseInt(pkg.version.split('.')[0]) >= 4) {
        console.warn('Deprication Warning. Remove _migrateFrom3v1v3')
      }
      if (process.platform !== 'win32') { return }
      if (fs.existsSync(this.__path__) === false) {
        const oldDbPath = new AppDirectory(pkg.name).userData()
        const oldPath = path.join(oldDbPath, bucketName + '_db.json')
        if (fs.existsSync(oldPath)) {
          fs.moveSync(oldPath, this.__path__)
        }
      }
    } catch (ex) {
      console.warn('3.1.3 Migration failed', ex)
    }
  }

  /* ****************************************************************************/
  // Persistence
  /* ****************************************************************************/

  /**
  * Loads the database from disk
  */
  _loadFromDiskSync () {
    let data = '{}'
    try {
      data = fs.readFileSync(this.__path__, 'utf8')
    } catch (ex) { }

    try {
      this.__data__ = JSON.parse(data)
    } catch (ex) {
      this.__data__ = {}
    }
  }

  /**
  * Writes the current data to disk
  */
  _writeToDisk () {
    clearTimeout(this.__writeHold__)
    this.__writeHold__ = setTimeout(() => {
      if (this.__writeLock__) {
        // Requeue in DB_WRITE_DELAY_MS
        this._writeToDisk()
      } else {
        this.__writeLock__ = true
        writeFileAtomic(this.__path__, JSON.stringify(this.__data__), () => {
          this.__writeLock__ = false
        })
      }
    }, DB_WRITE_DELAY_MS)
  }

  /* ****************************************************************************/
  // Getters
  /* ****************************************************************************/

  /**
  * @param k: the key of the item
  * @param d=undefined: the default value if not exists
  * @return the string item or d
  */
  getItem (k, d) {
    const json = this.__data__[k]
    return json || d
  }

  /**
  * @param k: the key of the item
  * @param d=undefined: the default value if not exists
  * @return the string item or d
  */
  getJSONItem (k, d) {
    const item = this.getItem(k)
    try {
      return item ? JSON.parse(item) : d
    } catch (ex) {
      return {}
    }
  }

  /**
  * @return a list of all keys
  */
  allKeys () {
    return Object.keys(this.__data__)
  }

  /**
  * @return all the items in an obj
  */
  allItems () {
    return this.allKeys().reduce((acc, key) => {
      acc[key] = this.getItem(key)
      return acc
    }, {})
  }

  /**
  * @return all the items in an obj json parsed
  */
  allJSONItems () {
    return this.allKeys().reduce((acc, key) => {
      acc[key] = this.getJSONItem(key)
      return acc
    }, {})
  }

  /**
  * @return the size of the file
  */
  getFileSize () {
    const stats = fs.statSync(this.__path__, 'utf8')
    return stats.size
  }

  /**
  * @return the length of each key
  */
  getKeyLengths () {
    return this.allKeys().reduce((acc, key) => {
      const item = this.getItem(key)
      if (item) {
        acc[key] = item.length
      }
      return acc
    }, {})
  }

  /**
  * @return a set of stats for this bucket
  */
  getStats () {
    return {
      filesize: this.getFileSize(),
      keyLengths: this.getKeyLengths(),
      dataSize: JSON.stringify(this.__data__).length
    }
  }

  /**
  * @param runs=20: the amount of times to run each test
  * @return some performance measures for this bucket
  */
  measurePerformance (runs = 20) {
    const serialize = (() => {
      const results = []
      for (let i = 0; i < runs; i++) {
        const start = new Date().getTime()
        JSON.stringify(this.__data__)
        const finish = new Date().getTime()
        results.push(finish - start)
      }
      return results
    })()

    const flush = (() => {
      const results = []
      for (let i = 0; i < runs; i++) {
        const data = JSON.stringify(this.__data__)
        const testPath = `${this.__path__}.measure`
        const start = new Date().getTime()
        writeFileAtomic.sync(testPath, JSON.stringify(data))
        const finish = new Date().getTime()
        results.push(finish - start)
      }
      return results
    })()

    const both = (() => {
      const results = []
      for (let i = 0; i < runs; i++) {
        const testPath = `${this.__path__}.measure`
        const start = new Date().getTime()
        writeFileAtomic.sync(testPath, JSON.stringify(this.__data__))
        const finish = new Date().getTime()
        results.push(finish - start)
      }
      return results
    })()

    return {
      serialize: serialize,
      flush: flush,
      both: both
    }
  }

  /* ****************************************************************************/
  // Modifiers
  /* ****************************************************************************/

  /**
  * @param k: the key to set
  * @param v: the value to set
  * @return v
  */
  _setItem (k, v) {
    this.__data__[k] = '' + v
    this._writeToDisk()
    this.emit('changed', { type: 'setItem', key: k })
    this.emit('changed:' + k, { })
    return v
  }

  /**
  * @param k: the key to remove
  */
  _removeItem (k) {
    delete this.__data__[k]
    this._writeToDisk()
    this.emit('changed', { type: 'removeItem', key: k })
    this.emit('changed:' + k, { })
  }

  /* ****************************************************************************/
  // IPC Access
  /* ****************************************************************************/

  /**
  * Responds to an ipc message
  * @param evt: the original event that fired
  * @param response: teh response to send
  * @param sendSync: set to true to respond synchronously
  */
  _sendIPCResponse (evt, response, sendSync = false) {
    if (sendSync) {
      evt.returnValue = response
    } else {
      evt.sender.send(this.__ipcReplyChannel__, response)
    }
  }

  /**
  * Sets an item over IPC
  * @param evt: the fired event
  * @param body: request body
  */
  _handleIPCSetItem (evt, body) {
    this._setItem(body.key, body.value)
    this._sendIPCResponse(evt, { id: body.id, response: null }, body.sync)
  }

  /**
  * Removes an item over IPC
  * @param evt: the fired event
  * @param body: request body
  */
  _handleIPCRemoveItem (evt, body) {
    this._removeItem(body.key)
    this._sendIPCResponse(evt, { id: body.id, response: null }, body.sync)
  }

  /**
  * Gets an item over IPC
  * @param evt: the fired event
  * @param body: request body
  */
  _handleIPCGetItem (evt, body) {
    this._sendIPCResponse(evt, {
      id: body.id,
      response: this.getItem(body.key)
    }, body.sync)
  }

  /**
  * Gets the keys over IPC
  * @param body: request body
  */
  _handleIPCAllKeys (evt, body) {
    this._sendIPCResponse(evt, {
      id: body.id,
      response: this.allKeys()
    }, body.sync)
  }

  /**
  * Gets all the items over IPC
  * @param body: request body
  */
  _handleIPCAllItems (evt, body) {
    this._sendIPCResponse(evt, {
      id: body.id,
      response: this.allItems()
    }, body.sync)
  }

  /**
  * Gets stats for the database
  * @param body: request body
  */
  _handleIPCGetStats (evt, body) {
    this._sendIPCResponse(evt, {
      id: body.id,
      response: this.getStats()
    }, body.sync)
  }

  /**
  * Measures the buckets performance
  * @param body: request body
  */
  _handleIPCMeasurePerformance (evt, body) {
    this._sendIPCResponse(evt, {
      id: body.id,
      response: this.measurePerformance(body.runs)
    }, body.sync)
  }
}

module.exports = StorageBucket
