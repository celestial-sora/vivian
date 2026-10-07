# Compiled hersona persona

Vivian uses hersona's `personality/tsundere` at `strong` intensity in every provider's system prompt. This is a compiled export, not a runtime Python dependency or a skill that the dialogue model must discover.

Source: https://github.com/shiro-0x/hersona
Source revision: `75146c9126e1614750eeead3da165d61a3fc2188` (pyproject version 1.11.1; checkout export reports 0.0.0+dev). MIT license is included.

Reproduce from that checkout with its Python dependencies installed:

```sh
python -c 'from hersona.cli import main; main()' --lang en --plain export personality/tsundere --weight strong --compact --no-persona-lock --format json
```

The export is preserved verbatim in `tsundere-strong.json`. `--lang en` changes CLI display, not the Japanese attribute language. The runtime adapter replaces the one Japanese response-language binding with Vivian's existing language selection and asks for natural localized equivalents. It does not add Hermes' SOUL.md persona lock. Vivian's canon, safety, truthful AI/capability disclosure and relationship state remain authoritative.

The Thai turn directive adds the user's requested refusal commitment and resistance to ordinary identity/introduction questions. It permits a later emotional shift, does not substitute hardcoded replies for model output, and places current custom preferences after older context. No extra LLM or hersona network call occurs per turn. Surface catchphrase checks are not proof of character quality; test actual conversations separately.
