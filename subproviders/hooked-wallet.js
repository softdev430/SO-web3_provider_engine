const async = require('async')
const inherits = require('util').inherits
const extend = require('xtend')
const Subprovider = require('./subprovider.js')

module.exports = HookedWalletSubprovider

// handles the following RPC methods:
//   eth_coinbase
//   eth_accounts
//   eth_sendTransaction
//   * eth_sign (TODO)


inherits(HookedWalletSubprovider, Subprovider)

function HookedWalletSubprovider(opts){
  const self = this

  self.getAccounts = opts.getAccounts
  // default to auto-approve
  self.approveTransaction = opts.approveTransaction || function(txParams, cb){ cb(null, true) }
  self.signTransaction = opts.signTransaction
}

HookedWalletSubprovider.prototype.handleRequest = function(payload, next, end){
  const self = this

  switch(payload.method) {

    case 'eth_coinbase':
      self.getAccounts(function(err, accounts){
        if (err) return end(err)
        var result = accounts[0] || null
        end(null, result)
      })
      return

    case 'eth_accounts':
      self.getAccounts(function(err, accounts){
        if (err) return end(err)
        end(null, accounts)
      })
      return

    case 'eth_sendTransaction':
      var txParams = payload.params[0]
      // approve
      self.approveTransaction(txParams, function(err, didApprove){
        if (err) return end(err)
        if (!didApprove) return end(new Error('User denied transaction.'))
        // autofill
        self.fillInTxExtras(txParams, function(err, fullTxParams){
          if (err) return end(err)
          // sign
          self.signTransaction(fullTxParams, function(err, rawTx){
            if (err) return end(err)
            // submit
            self.submitTx(rawTx, end)
          })
        })
      })
      return

    // case 'eth_sign':
    //   var result = self.keystore.getAddresses()
    //   resultObj.result = result
    //   cb(null, resultObj)
    //   return

    default:
      next()
      return

  }
}

HookedWalletSubprovider.prototype.submitTx = function(rawTx, cb) {
  const self = this
  self.emitPayload({
    method: 'eth_sendRawTransaction',
    params: [rawTx],
  }, function(err, result){
    if (err) return cb(err)
    cb(null, result.result)
  })
}

HookedWalletSubprovider.prototype.fillInTxExtras = function(txData, cb){
  const self = this
  var address = txData.from
  // console.log('fillInTxExtras - address:', address)
  async.parallel({
    gasPrice: self.emitPayload.bind(self, { method: 'eth_gasPrice', params: [] }),
    nonce:    self.emitPayload.bind(self, { method: 'eth_getTransactionCount', params: [address, 'pending'] }),
    // gas:      self.emitPayload.bind(self, { method: 'eth_estimateGas', params: [] }),
  }, function(err, result){
    if (err) return cb(err)
    // console.log('fillInTxExtras - result:', result)
    var fullTxData = extend({
      gasPrice: result.gasPrice.result,
      nonce: result.nonce.result,
      gas: '0x9000',
      // gas: result.nonce.gas,
    }, txData)
    cb(null, fullTxData)
  })
}
