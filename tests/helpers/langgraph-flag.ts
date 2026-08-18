import { ENABLE_LANGGRAPH } from '@/lib/feature-langgraph';
import { describe as vitestDescribe, it as vitestIt, test as vitestTest } from 'vitest';

/** Run describe block only when LangGraph compile flag is enabled. */
export const describeLangGraph = ENABLE_LANGGRAPH ? vitestDescribe : vitestDescribe.skip;
/** Run test case only when LangGraph compile flag is enabled. */
export const itLangGraph = ENABLE_LANGGRAPH ? vitestIt : vitestIt.skip;
/** Alias of itLangGraph for tests using test(...) style. */
export const testLangGraph = ENABLE_LANGGRAPH ? vitestTest : vitestTest.skip;

export { ENABLE_LANGGRAPH };
