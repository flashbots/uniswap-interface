import { BigNumber } from '@ethersproject/bignumber'
import { JsonRpcProvider } from '@ethersproject/providers'
// eslint-disable-next-line no-restricted-imports
// import { t, Trans } from '@lingui/macro'
import { Trade } from '@uniswap/router-sdk'
import { Currency, TradeType } from '@uniswap/sdk-core'
import { Trade as V2Trade } from '@uniswap/v2-sdk'
import { Trade as V3Trade } from '@uniswap/v3-sdk'
import { VERIFYING_CONTRACT_EIP712 } from 'constants/addresses'
import { useMemo } from 'react'
// import { calculateGasMargin } from 'utils/calculateGasMargin'
// import isZero from 'utils/isZero'
// import { swapErrorToUserReadableMessage } from 'utils/swapErrorToUserReadableMessage'

type AnyTrade =
  | V2Trade<Currency, Currency, TradeType>
  | V3Trade<Currency, Currency, TradeType>
  | Trade<Currency, Currency, TradeType>

/** Definition of an order in our EIP-712 message */
export interface SwapMessage {
  router: string // address
  amountIn: BigNumber
  amountOut: BigNumber
  tradeType: string // TODO: enum?
  recipient: string // address
  path: string[]
  deadline: number
  sqrtPriceLimitX96: BigNumber
  fee: number
  // TODO: idea: generalize to support non-uniswap? let order filler decide execution method themselves; don't do it here.
}

export interface JsonRpcResponse {
  id?: string | number
  jsonrpc: string // `2.0`
  result: string
}

export interface SignedMessageResponse {
  signature: string
  message: any // TODO: strongly type this
}

// returns a function that will ask the user to sign a message
export default function useSendSwapMessage(
  account: string | null | undefined,
  chainId: number | undefined,
  library: JsonRpcProvider | undefined,
  trade: AnyTrade | undefined, // trade to execute, required
  swapMessages: SwapMessage[]
): { callback: null | (() => Promise<SignedMessageResponse>) } {
  return useMemo(() => {
    if (!trade || !library || !account || !chainId) {
      return { callback: null }
    }
    return {
      callback: async function onSwap(): Promise<SignedMessageResponse> {
        console.log('[useSendSwapMessage] swapMessages', swapMessages)

        const message = swapMessages[0] // TODO: use array appropriately or remove it

        const messagePayload = {
          types: {
            EIP712Domain: [
              { name: 'name', type: 'string' },
              { name: 'version', type: 'string' },
              { name: 'chainId', type: 'uint256' },
              { name: 'verifyingContract', type: 'address' },
            ],
            SwapOrder: [
              { name: 'router', type: 'address' },
              { name: 'amountIn', type: 'uint256' },
              { name: 'amountOut', type: 'uint256' },
              { name: 'tradeType', type: 'string' },
              { name: 'recipient', type: 'address' },
              { name: 'path', type: 'address[]' },
              { name: 'deadline', type: 'uint' },
              { name: 'sqrtPriceLimitX96', type: 'uint256' },
              { name: 'fee', type: 'uint256' },
            ],
          },
          domain: {
            name: 'SonOfASwap',
            version: '1',
            chainId: chainId.toString(),
            verifyingContract: VERIFYING_CONTRACT_EIP712[chainId],
          },
          primaryType: 'SwapOrder',
          message: {
            router: message.router,
            amountIn: message.amountIn.toString(),
            amountOut: message.amountOut.toString(),
            tradeType: message.tradeType,
            recipient: account,
            path: message.path,
            deadline: message.deadline.toString(),
            sqrtPriceLimitX96: message.sqrtPriceLimitX96.toString(),
            fee: message.fee.toString(),
          },
        }

        const signatureRes = await library.send('eth_signTypedData_v4', [
          await library.getSigner().getAddress(),
          JSON.stringify(messagePayload),
        ])
        console.log('***signatureRes', signatureRes)
        return {
          signature: signatureRes,
          message: messagePayload,
        }
      },
    }
  }, [account, chainId, library, swapMessages, trade])
}
