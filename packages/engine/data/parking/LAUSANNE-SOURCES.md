# Lausanne park-and-ride: sources

Status: NOT FILLED. On 2026-11-10 every request to www.lausanne.ch (home page, robots.txt, sitemap.xml and
guessed P+R page paths) returned "Request Rejected" (a web-application-firewall block, HTTP 334 body) with
`curl -A 'Mozilla/5.0'` through the sandbox proxy. I did not try to get around the filter.

Therefore `lausanne-pr.json` holds only the five site names from the product spec (Vennes, Bourdonnette,
Vélodrome, Valmont, Mont-sur-Lausanne) with everything else null:

- coordinates / street address: not found
- capacity: not found
- daily price, monthly pass price: not found
- whether day/month price includes public transport (Mobilis zones 11+12; Vennes parking only): spec claim, not confirmed
- other sites the city lists (Ouchy, Provence, ...): not checked
- nearest stop: not found

No page URL was successfully fetched, so `sourceUrl` is null for all sites.

To finish: fetch the city's "parkings relais" page from an unblocked network (or paste its text), then fill the JSON.
