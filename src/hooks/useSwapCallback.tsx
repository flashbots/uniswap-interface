// eslint-disable-next-line no-restricted-imports
// import { BigNumber } from '@ethersproject/bignumber'
import { Transaction } from '@ethersproject/transactions'
import { MessageTypes, TypedMessage } from '@metamask/eth-sig-util'
import { Percent, TradeType } from '@uniswap/sdk-core'
import axios from 'axios'
import useActiveWeb3React from 'hooks/useActiveWeb3React'
import { SwapCallbackState, useSwapCallback as useLibSwapCallBack } from 'lib/hooks/swap/useSwapCallback'
import { TransactionType } from 'lib/state/transactions'
import { ReactNode, useMemo } from 'react'
import { currencyId } from 'utils/currencyId'

import { useTransactionAdder } from '../state/transactions/hooks'
// import { TransactionType } from '../state/transactions/types'
// import { currencyId } from '../utils/currencyId'
import useENS from './useENS'
import { SignatureData } from './useERC20Permit'
import { AnyTrade } from './useSwapMessageArguments'
import useTransactionDeadline from './useTransactionDeadline'

// TODO: move these interfaces to an appropriate location
interface SignedMessageRequest {
  trade_signature: string
  data: TypedMessage<MessageTypes>
  block_number?: string
}

interface SentMessageResponse {
  pendingTx: Transaction
}

// returns a function that will execute a swap, if the parameters are all valid
// and the user has approved the slippage adjusted input amount for the trade
export function useSwapCallback(
  trade: AnyTrade | undefined, // trade to execute, required
  allowedSlippage: Percent, // in bips
  recipientAddressOrName: string | null, // the ENS name or address of the recipient of the trade, or null if swap should be returned to sender
  signatureData: SignatureData | undefined | null
): { state: SwapCallbackState; callback: null | (() => Promise<string | null>); error: ReactNode | null } {
  const { account, library } = useActiveWeb3React()

  const deadline = useTransactionDeadline()
  const addTransaction = useTransactionAdder()

  const { address: recipientAddress } = useENS(recipientAddressOrName)
  const recipient = recipientAddressOrName === null ? account : recipientAddress

  const {
    state,
    callback: libCallback,
    error,
  } = useLibSwapCallBack({ trade, allowedSlippage, recipientAddressOrName: recipient, signatureData, deadline })
  const callback: null | (() => Promise<string | null>) = useMemo(() => {
    let pendingTxHash: string
    if (!libCallback || !trade) {
      return null
    }
    return () =>
      libCallback().then(async (response) => {
        if (library) {
          const signedMessageRequest: SignedMessageRequest = {
            trade_signature: response.signature,
            data: response.message,
            block_number: ((await library.getBlockNumber()) + 1).toString(),
          }

          const USE_POC = true
          let data: SentMessageResponse
          if (USE_POC) {
            console.log('* Using PoC backend')
            data = (await axios.post('http://localhost:8080/uniswap', signedMessageRequest)).data
            console.log('***RESPONSE', data)
          } else {
            console.log('* Using eip712-proxy backend')
            // TODO: use `eip712-proxy` -- waiting for Bhaki (interface doesn't unmarshal properly)
            const payload = {
              jsonrpc: '2.0',
              method: 'eth_executeTradeSignature',
              params: signedMessageRequest,
              id: '1',
            }
            console.log('***PAYLOAD', JSON.stringify(payload))
            data = (await axios.post('http://localhost:9001/uniswap', payload)).data
          }

          const { hash, from } = data.pendingTx
          if (hash && from) {
            pendingTxHash = hash
            const pendingTx = {
              ...data.pendingTx,
              hash,
              from,
              confirmations: 0,
              wait: async () => {
                return await library.getTransactionReceipt(hash)
              },
            }
            addTransaction(
              pendingTx,
              trade.tradeType === TradeType.EXACT_INPUT
                ? {
                    type: TransactionType.SWAP,
                    tradeType: TradeType.EXACT_INPUT,
                    inputCurrencyId: currencyId(trade.inputAmount.currency),
                    inputCurrencyAmountRaw: trade.inputAmount.quotient.toString(),
                    expectedOutputCurrencyAmountRaw: trade.outputAmount.quotient.toString(),
                    outputCurrencyId: currencyId(trade.outputAmount.currency),
                    minimumOutputCurrencyAmountRaw: trade.minimumAmountOut(allowedSlippage).quotient.toString(),
                  }
                : {
                    type: TransactionType.SWAP,
                    tradeType: TradeType.EXACT_OUTPUT,
                    inputCurrencyId: currencyId(trade.inputAmount.currency),
                    maximumInputCurrencyAmountRaw: trade.maximumAmountIn(allowedSlippage).quotient.toString(),
                    outputCurrencyId: currencyId(trade.outputAmount.currency),
                    outputCurrencyAmountRaw: trade.outputAmount.quotient.toString(),
                    expectedInputCurrencyAmountRaw: trade.inputAmount.quotient.toString(),
                  }
            )
          }
        }
        // return response.result
        console.log('response!!', JSON.stringify(response))
        if (pendingTxHash) {
          return pendingTxHash
        } else {
          return null
        }
      })
  }, [addTransaction, allowedSlippage, libCallback, trade, library])

  return {
    state,
    callback,
    error,
  }
}
