---
name: Bug report
about: Something does not behave as documented
labels: bug
---

**What happened**

**What you expected**

**Steps to reproduce**

**Environment**
- OS:
- VS Code version:
- Node version (`node -v`):
- ClaudeStats version:
- Plan type (Pro / Max / Team):

**What the hover says**
Paste the hover contents, including the age and source line.

**Diagnostics**
```
node -e "const o=require('os');console.log(require(o.homedir()+'/.claude/settings.json').statusLine)"
```

Please do not paste the contents of `.credentials.json`. It contains an access token.
