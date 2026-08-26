# Sanctions

Target under active sanction cannot submit an appeal via normal HTTP flow because SessionVerifier rejects requests with `account_restricted`. This is a known MVP limitation; a dedicated appeal-only auth path can be added later.
