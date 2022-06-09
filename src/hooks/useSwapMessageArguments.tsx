import { BigNumber } from '@ethersproject/bignumber'
import { RouteV2, RouteV3, Trade } from '@uniswap/router-sdk'
import { Currency, Percent, TradeType } from '@uniswap/sdk-core'
// import { Router as V2SwapRouter, Trade as V2Trade } from '@uniswap/v2-sdk'
import { Trade as V2Trade } from '@uniswap/v2-sdk'
import { FeeOptions, Trade as V3Trade } from '@uniswap/v3-sdk'
import useActiveWeb3React from 'hooks/useActiveWeb3React'
import { SwapMessage } from 'lib/hooks/swap/useSendSwapMessage'
import { useSwapRouterAddress } from 'lib/hooks/swap/useSwapApproval'
import { useMemo } from 'react'

// import { useArgentWalletContract } from './useArgentWalletContract'
// import { useV2RouterContract } from './useContract'
import useENS from './useENS'
import { SignatureData } from './useERC20Permit'

export type AnyTrade =
  | V2Trade<Currency, Currency, TradeType>
  | V3Trade<Currency, Currency, TradeType>
  | Trade<Currency, Currency, TradeType>

interface MessageParams {
  tradeType: string
  path: string[]
  amountIn: BigNumber
  amountOut: BigNumber
}

enum RouterVersion {
  V2 = 2,
  V3 = 3,
}

/**
 * Produces the on-chain method name to call and the hex encoded parameters to pass as arguments for a given trade.
 * @param trade to produce call parameters for
 * @param options options for the call parameters
 */
function swapMessageParameters(trade: AnyTrade): MessageParams {
  let path: string[] = []
  let singleHop = true // TODO: are my `singleHop` interpretations correct?
  let routerVersion: RouterVersion
  if (trade instanceof V3Trade) {
    path = trade.swaps[0].route.tokenPath.map((p) => p.address)
    singleHop = trade.swaps[0].route.pools.length === 1
    routerVersion = RouterVersion.V3
  } else if (trade instanceof V2Trade) {
    path = trade.route.path.map((p) => p.address)
    routerVersion = RouterVersion.V2
  } else {
    singleHop = trade.swaps[0].route.pools.length === 1
    path = trade.swaps[0].route.path.map((p) => p.address)
    routerVersion = trade.routes.every((route) => route instanceof RouteV3)
      ? RouterVersion.V3
      : trade.routes.every((route) => route instanceof RouteV2)
      ? RouterVersion.V2
      : RouterVersion.V3 // default to V3 if there is a mix of routes
    // TODO: allow split (V2+v3) purchases
  }

  const amountIn = BigNumber.from(trade.inputAmount.numerator.toString()).div(
    BigNumber.from(trade.inputAmount.denominator.toString())
  )
  const amountOut = BigNumber.from(trade.outputAmount.numerator.toString()).div(
    BigNumber.from(trade.outputAmount.denominator.toString())
  )

  let tradeType: string
  if (routerVersion === RouterVersion.V3) {
    if (singleHop) {
      if (trade.tradeType === TradeType.EXACT_INPUT) {
        tradeType = 'v3_exactInputSingle'
      } else {
        tradeType = 'v3_exactOutputSingle'
      }
    } else {
      if (trade.tradeType === TradeType.EXACT_INPUT) {
        tradeType = 'v3_exactInput'
      } else {
        tradeType = 'v3_exactOutput'
      }
    }
  } else {
    if (trade.tradeType === TradeType.EXACT_INPUT) {
      tradeType = 'v2_swapExactTokensForTokens'
    } else {
      tradeType = 'v2_swapTokensForExactTokens'
    }
  }
  return {
    tradeType,
    path,
    amountIn,
    amountOut,
  }
}

/**
 * Returns the swap calls that can be used to make the trade
 * @param trade trade to execute
 * @param allowedSlippage user allowed slippage
 * @param recipientAddressOrName the ENS name or address of the recipient of the swap output
 * @param signatureData the signature data of the permit of the input token amount, if available
 */
export function useSwapMessageArguments(
  trade: AnyTrade | undefined,
  _allowedSlippage: Percent,
  recipientAddressOrName: string | null | undefined,
  _signatureData: SignatureData | null | undefined,
  deadline: BigNumber | undefined,
  _feeOptions: FeeOptions | undefined
): SwapMessage[] {
  const { account, chainId, library } = useActiveWeb3React()

  const { address: recipientAddress } = useENS(recipientAddressOrName)
  const recipient = recipientAddressOrName === null ? account : recipientAddress
  // const routerContract = useV2RouterContract()
  // const argentWalletContract = useArgentWalletContract()
  const swapRouterAddress = useSwapRouterAddress(trade)

  return useMemo(() => {
    if (!trade || !recipient || !library || !account || !chainId || !deadline || !swapRouterAddress) return []
    const messageParams = swapMessageParameters(trade)

    const swap: SwapMessage = {
      router: swapRouterAddress,
      amountIn: messageParams.amountIn,
      amountOut: messageParams.amountOut,
      tradeType: messageParams.tradeType, // TODO: enum?
      recipient,
      path: messageParams.path,
      deadline: deadline.toNumber(),
      sqrtPriceLimitX96: BigNumber.from(0), // TODO: get real value for this
      fee: 3000, // TODO: get real value for this
    }
    return [swap]

    /* punt Argent impl for now */
    // V2 Argent stuff
    // ====================================================================================
    //   // return swapMethods.map(({ methodName, args, value }) => {
    //   //   if (argentWalletContract && trade.inputAmount.currency.isToken) {
    //   //     return {
    //   //       address: argentWalletContract.address,
    //   //       calldata: argentWalletContract.interface.encodeFunctionData('wc_multiCall', [
    //   //         [
    //   //           approveAmountCalldata(trade.maximumAmountIn(allowedSlippage), routerContract.address),
    //   //           {
    //   //             to: routerContract.address,
    //   //             value,
    //   //             data: routerContract.interface.encodeFunctionData(methodName, args),
    //   //           },
    //   //         ],
    //   //       ]),
    //   //       value: '0x0',
    //   //     }
    //   //   } else {
    //   //     return {
    //   //       address: routerContract.address,
    //   //       calldata: routerContract.interface.encodeFunctionData(methodName, args),
    //   //       value,
    //   //     }
    //   //   }
    //   // })
    // } else {
    // V3 Argent stuff
    //   // ====================================================================================
    //   // if (argentWalletContract && trade.inputAmount.currency.isToken) {
    //   //   return [
    //   //     {
    //   //       address: argentWalletContract.address,
    //   //       calldata: argentWalletContract.interface.encodeFunctionData('wc_multiCall', [
    //   //         [
    //   //           approveAmountCalldata(trade.maximumAmountIn(allowedSlippage), swapRouterAddress),
    //   //           {
    //   //             to: swapRouterAddress,
    //   //             value,
    //   //             data: calldata,
    //   //           },
    //   //         ],
    //   //       ]),
    //   //       value: '0x0',
    //   //     },
    //   //   ]
    //   // }
    //   // return [
    //   //   {
    //   //     address: swapRouterAddress,
    //   //     calldata,
    //   //     value,
    //   //   },
    //   // ]
    // }
  }, [
    account,
    // allowedSlippage, // TODO: re-evaluate whether we need this
    // argentWalletContract,
    chainId,
    deadline,
    // feeOptions,
    library,
    recipient,
    // routerContract,
    // signatureData,
    swapRouterAddress,
    trade,
  ])
}
