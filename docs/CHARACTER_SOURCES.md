# Character asset sources

The skinned fighters are assembled by `tools/build-character.py` from these public-domain (CC0 1.0)
packs. Nothing here is a copyrighted game or film asset; every source below is dedicated to the
public domain by its author and is used with recolouring, trimming and retargeting.

| Part | Source | Author | Licence |
| --- | --- | --- | --- |
| Skeleton (65-joint Universal rig), head, eyes, eyebrows, hairstyles | [Universal Base Characters](https://quaternius.com/packs/universalbasecharacters.html) (Standard) | Quaternius | CC0 1.0 |
| Outfit meshes and atlas (Ranger, recoloured per part) | [Modular Character Outfits – Fantasy](https://quaternius.com/packs/modularcharacteroutfitsfantasy.html) (Standard) | Quaternius | CC0 1.0 |
| Sword clips, block, slide, knockback, with root motion | [Universal Animation Library 2](https://quaternius.com/packs/universalanimationlibrary.html) (Standard, `_RM` file) | Quaternius | CC0 1.0 |
| Idle, walk, run, hit and death clips, retargeted onto the Universal rig | [KayKit – Character Pack: Adventurers 2.0](https://kaylousberg.itch.io/kaykit-adventurers) (Free) | Kay Lousberg | CC0 1.0 |

The katana, the weapon trail and every material tweak are original.

## Rebuilding

The source packs are not committed (they are 100–300 MB each). Download the free tiers from the
links above, unpack them under one directory as `ubc/x`, `outfits/x`, `ual/x`, `kaykit/x`, then:

```bash
python3 tools/build-character.py <that directory> public/assets/characters/player.glb
```

`numpy` and `Pillow` are the only Python dependencies.
