# Spare Swipe

A [Lumiverse](https://github.com/prolix-oc/Lumiverse) extension. While a reply
streams, it generates a second reply from the same prompt and adds it as the
next swipe. The streamed reply stays on screen; swipe right to see the
alternative instantly.

It suits a local backend with spare batch capacity, such as vLLM: the second
request starts after the first token arrives, so it reuses the prefix cache
instead of processing the prompt again. On a paid API it doubles your cost.

## Install

In Lumiverse, open **Extensions → Install** and enter
`https://github.com/davidgibbons/lumiverse-spare-swipe`, then grant the
requested permissions. Disable the extension to turn it off.

## Behavior

- Runs for normal sends, regenerations and swipes. Continue, impersonate and
  quiet generations are skipped.
- Stopping a generation cancels the spare.
- Sampling comes from your active preset, not from parameters another
  extension injects into the main generation.
- Response-target regex scripts are applied to the spare. Scripts that use
  macro substitution or match actions are skipped and logged.
