import { Protocol, Trade } from '@uniswap/router-sdk'
import { Currency, CurrencyAmount, Percent, Token, TradeType } from '@uniswap/sdk-core'
import { Pair, Route as V2Route, Trade as V2Trade } from '@uniswap/v2-sdk'
import { Pool, Route as V3Route, Trade as V3Trade } from '@uniswap/v3-sdk'
import {
  SWAP_ROUTER_ADDRESSES,
  V2_ROUTER_ADDRESS,
  V3_ROUTER_ADDRESS,
  VERIFYING_CONTRACT_EIP712,
} from 'constants/addresses'
import useActiveWeb3React from 'hooks/useActiveWeb3React'
import { useERC20PermitFromTrade, UseERC20PermitState } from 'hooks/useERC20Permit'
import useTransactionDeadline from 'lib/hooks/useTransactionDeadline'
import { useCallback, useMemo } from 'react'
import { getTxOptimizedSwapRouter, SwapRouterVersion } from 'utils/getTxOptimizedSwapRouter'

import { ApprovalState, useApproval, useApprovalStateForSpender } from '../useApproval'
export { ApprovalState } from '../useApproval'

/** Returns approval state for all known swap routers */
function useSwapApprovalStates(
  trade: Trade<Currency, Currency, TradeType> | undefined,
  allowedSlippage: Percent,
  useIsPendingApproval: (token?: Token, spender?: string) => boolean
): { v2: ApprovalState; v3: ApprovalState; v2V3: ApprovalState } {
  const { chainId } = useActiveWeb3React()

  const amountToApprove = useMemo(
    () => (trade && trade.inputAmount.currency.isToken ? trade.maximumAmountIn(allowedSlippage) : undefined),
    [trade, allowedSlippage]
  )

  const verifyAndExecuteAddress = chainId ? VERIFYING_CONTRACT_EIP712[chainId] : undefined
  const approvalState = useApprovalStateForSpender(amountToApprove, verifyAndExecuteAddress, useIsPendingApproval)

  return useMemo(() => ({ v2: approvalState, v3: approvalState, v2V3: approvalState }), [approvalState])
}

export function useSwapRouterAddress(
  trade:
    | V2Trade<Currency, Currency, TradeType>
    | V3Trade<Currency, Currency, TradeType>
    | Trade<Currency, Currency, TradeType>
    | undefined
) {
  const { chainId } = useActiveWeb3React()
  return useMemo(
    () =>
      chainId
        ? trade instanceof V2Trade
          ? V2_ROUTER_ADDRESS[chainId]
          : trade instanceof V3Trade
          ? V3_ROUTER_ADDRESS[chainId]
          : SWAP_ROUTER_ADDRESSES[chainId]
        : undefined,
    [chainId, trade]
  )
}

// wraps useApproveCallback in the context of a swap
export default function useSwapApproval(
  trade:
    | V2Trade<Currency, Currency, TradeType>
    | V3Trade<Currency, Currency, TradeType>
    | Trade<Currency, Currency, TradeType>
    | undefined,
  allowedSlippage: Percent,
  useIsPendingApproval: (token?: Token, spender?: string) => boolean,
  amount?: CurrencyAmount<Currency> // defaults to trade.maximumAmountIn(allowedSlippage)
) {
  const { chainId } = useActiveWeb3React()
  const amountToApprove = useMemo(
    () => amount || (trade && trade.inputAmount.currency.isToken ? trade.maximumAmountIn(allowedSlippage) : undefined),
    [amount, trade, allowedSlippage]
  )
  // allow verifyAndSend contract to access tokens
  const spender = VERIFYING_CONTRACT_EIP712[chainId || 0]
  const approval = useApproval(amountToApprove, spender, useIsPendingApproval)
  return approval
}

export function useSwapApprovalOptimizedTrade(
  trade: Trade<Currency, Currency, TradeType> | undefined,
  allowedSlippage: Percent,
  useIsPendingApproval: (token?: Token, spender?: string) => boolean
):
  | V2Trade<Currency, Currency, TradeType>
  | V3Trade<Currency, Currency, TradeType>
  | Trade<Currency, Currency, TradeType>
  | undefined {
  const onlyV2Routes = trade?.routes.every((route) => route.protocol === Protocol.V2)
  const onlyV3Routes = trade?.routes.every((route) => route.protocol === Protocol.V3)
  const tradeHasSplits = (trade?.routes.length ?? 0) > 1
  tradeHasSplits && console.error("TRADE HAS SPLITS! We don't support this...")

  const approvalStates = useSwapApprovalStates(trade, allowedSlippage, useIsPendingApproval)

  const optimizedSwapRouter = useMemo(
    () => getTxOptimizedSwapRouter({ onlyV2Routes, onlyV3Routes, tradeHasSplits, approvalStates }),
    [approvalStates, tradeHasSplits, onlyV2Routes, onlyV3Routes]
  )

  return useMemo(() => {
    if (!trade) return undefined

    try {
      switch (optimizedSwapRouter) {
        case SwapRouterVersion.V2V3:
          return trade
        case SwapRouterVersion.V2:
          const pairs = trade.swaps[0].route.pools.filter((pool) => pool instanceof Pair) as Pair[]
          const v2Route = new V2Route(pairs, trade.inputAmount.currency, trade.outputAmount.currency)
          return new V2Trade(v2Route, trade.inputAmount, trade.tradeType)
        case SwapRouterVersion.V3:
          return V3Trade.createUncheckedTradeWithMultipleRoutes({
            routes: trade.swaps.map(({ route, inputAmount, outputAmount }) => ({
              route: new V3Route(
                route.pools.filter((p) => p instanceof Pool) as Pool[],
                inputAmount.currency,
                outputAmount.currency
              ),
              inputAmount,
              outputAmount,
            })),
            tradeType: trade.tradeType,
          })
        default:
          return undefined
      }
    } catch (e) {
      // TODO(#2989): remove try-catch
      console.debug(e)
      return undefined
    }
  }, [trade, optimizedSwapRouter])
}

export enum ApproveOrPermitState {
  REQUIRES_APPROVAL,
  PENDING_APPROVAL,
  REQUIRES_SIGNATURE,
  PENDING_SIGNATURE,
  APPROVED,
}

/**
 * Returns all relevant statuses and callback functions for approvals.
 * Considers both standard approval and ERC20 permit.
 */
export const useApproveOrPermit = (
  trade:
    | V2Trade<Currency, Currency, TradeType>
    | V3Trade<Currency, Currency, TradeType>
    | Trade<Currency, Currency, TradeType>
    | undefined,
  allowedSlippage: Percent,
  useIsPendingApproval: (token?: Token, spender?: string) => boolean,
  amount?: CurrencyAmount<Currency> // defaults to trade.maximumAmountIn(allowedSlippage)
) => {
  const deadline = useTransactionDeadline()

  // Check approvals on ERC20 contract based on amount.
  const [approval, getApproval] = useSwapApproval(trade, allowedSlippage, useIsPendingApproval, amount)

  // Check status of permit and whether token supports it.
  const {
    state: signatureState,
    signatureData,
    gatherPermitSignature,
  } = useERC20PermitFromTrade(trade, allowedSlippage, deadline)

  // If permit is supported, trigger a signature, if not create approval transaction.
  const handleApproveOrPermit = useCallback(async () => {
    try {
      if (signatureState === UseERC20PermitState.NOT_SIGNED && gatherPermitSignature) {
        try {
          return await gatherPermitSignature()
        } catch (error) {
          // Try to approve if gatherPermitSignature failed for any reason other than the user rejecting it.
          if (error?.code !== 4001) {
            return await getApproval()
          }
        }
      } else {
        return await getApproval()
      }
    } catch (e) {
      // Swallow approval errors - user rejections do not need to be displayed.
    }
  }, [signatureState, gatherPermitSignature, getApproval])

  const approvalState = useMemo(() => {
    if (approval === ApprovalState.PENDING) {
      return ApproveOrPermitState.PENDING_APPROVAL
    } else if (signatureState === UseERC20PermitState.LOADING) {
      return ApproveOrPermitState.PENDING_SIGNATURE
    } else if (approval !== ApprovalState.NOT_APPROVED || signatureState === UseERC20PermitState.SIGNED) {
      return ApproveOrPermitState.APPROVED
    } else if (gatherPermitSignature) {
      return ApproveOrPermitState.REQUIRES_SIGNATURE
    } else {
      return ApproveOrPermitState.REQUIRES_APPROVAL
    }
  }, [approval, gatherPermitSignature, signatureState])

  return {
    approvalState,
    signatureData,
    handleApproveOrPermit,
  }
}
