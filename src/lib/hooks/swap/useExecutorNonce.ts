import EXECUTOR_ABI from 'abis/sonOfASwap.json'
import { VERIFYING_CONTRACT_EIP712 } from 'constants/addresses'
import { Contract } from 'ethers'
import useActiveWeb3React from 'hooks/useActiveWeb3React'
import { useSingleCallResult } from 'lib/hooks/multicall'
import { useMemo } from 'react'

function useExecutorContract(): Contract | null {
  const { chainId, library } = useActiveWeb3React()
  console.log('VERIFYING CONTRACT', VERIFYING_CONTRACT_EIP712[chainId || 0])
  return useMemo(() => {
    if (chainId && library) {
      return new Contract(VERIFYING_CONTRACT_EIP712[chainId], EXECUTOR_ABI, library)
    } else {
      return null
    }
  }, [chainId, library])
}

/**
 * Returns the nonce of the recipient on the Trade Executor contract.
 * @param recipient
 * @returns
 */
export function useExecutorNonce(recipient: string): string | null {
  const contract = useExecutorContract()
  const nonce = useSingleCallResult(contract, 'nonces', [recipient]).result?.toString()
  return nonce ? nonce : null
}
