console.log("--- LOADED SCRIPT VERSION 5.0 (SCORE FIX) ---");
// === Configuration ===
const SUPABASE_URL = 'SUPABASE URL';
//Anon key with only access to the functions, no direct table access, and rate limited to prevent abuse.
const SUPABASE_KEY = 'SUPABASE ANON KEY';
const BASE_URL = `${SUPABASE_URL}/functions/v1`;

// Global State
let CURRENT_SEASON_GAMES = [];
let CURRENT_GAME_ID = null; // <--- NEW: Tracks the current game ID

const NBA_TEAMS = [
    { code: "ATL", name: "Atlanta Hawks" }, { code: "BOS", name: "Boston Celtics" },
    { code: "BKN", name: "Brooklyn Nets" }, { code: "CHA", name: "Charlotte Hornets" },
    { code: "CHI", name: "Chicago Bulls" }, { code: "CLE", name: "Cleveland Cavaliers" },
    { code: "DAL", name: "Dallas Mavericks" }, { code: "DEN", name: "Denver Nuggets" },
    { code: "DET", name: "Detroit Pistons" }, { code: "GSW", name: "Golden State Warriors" },
    { code: "HOU", name: "Houston Rockets" }, { code: "IND", name: "Indiana Pacers" },
    { code: "LAC", name: "LA Clippers" }, { code: "LAL", name: "Los Angeles Lakers" },
    { code: "MEM", name: "Memphis Grizzlies" }, { code: "MIA", name: "Miami Heat" },
    { code: "MIL", name: "Milwaukee Bucks" }, { code: "MIN", name: "Minnesota Timberwolves" },
    { code: "NOP", name: "New Orleans Pelicans" }, { code: "NYK", name: "New York Knicks" },
    { code: "OKC", name: "Oklahoma City Thunder" }, { code: "ORL", name: "Orlando Magic" },
    { code: "PHI", name: "Philadelphia 76ers" }, { code: "PHX", name: "Phoenix Suns" },
    { code: "POR", name: "Portland Trail Blazers" }, { code: "SAC", name: "Sacramento Kings" },
    { code: "SAS", name: "San Antonio Spurs" }, { code: "TOR", name: "Toronto Raptors" },
    { code: "UTA", name: "Utah Jazz" }, { code: "WAS", name: "Washington Wizards" }
];

document.addEventListener('DOMContentLoaded', () => {
    // 1. Populate Team Dropdown
    const teamSelect = document.getElementById('teamSelect');
    if (teamSelect) {
        NBA_TEAMS.forEach(team => {
            const option = document.createElement('option');
            option.value = team.code;
            option.textContent = `${team.code} - ${team.name}`;
            teamSelect.appendChild(option);
        });
        
        // Listener: Team Change
        teamSelect.addEventListener('change', () => {
            fetchSeasonAndSetupDropdowns(teamSelect.value, document.getElementById('yearInput').value);
        });
    }

    // Listener: Player Search
    document.getElementById('playerBtn').addEventListener('click', () => {
        const name = document.getElementById('playerSearch').value.trim();
        if (name) fetchPlayerRotation(name);
    });

    // Listener: Year Change
    document.getElementById('yearInput').addEventListener('change', () => {
        if(teamSelect.value) fetchSeasonAndSetupDropdowns(teamSelect.value, document.getElementById('yearInput').value);
    });

    // Listener: Month Change
    document.getElementById('monthSelect').addEventListener('change', (e) => filterGamesByMonth(e.target.value));

    // Listener: Load Game
    document.getElementById('loadGameBtn').addEventListener('click', () => {
        const gameId = document.getElementById('gameSelect').value;
        if (gameId) loadGameView(gameId);
    });    


// --- NEW: ARROW LISTENERS ---
    const prevBtn = document.getElementById('prevGameBtn');
    const nextBtn = document.getElementById('nextGameBtn');

    if (prevBtn) {
        prevBtn.addEventListener('click', (e) => {
            e.preventDefault();
            navigateGame(-1); // Go back 1
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', (e) => {
            e.preventDefault();
            navigateGame(1); // Go forward 1
        });
    }
});

// --- NEW: NAVIGATION LOGIC ---
function navigateGame(direction) {
    if (!CURRENT_GAME_ID || CURRENT_SEASON_GAMES.length === 0) {
        console.warn("Cannot navigate: No current game or empty season.");
        return;
    }

    // Find index of current game in the full season list
    const currentIndex = CURRENT_SEASON_GAMES.findIndex(g => g.gameId === CURRENT_GAME_ID);

    if (currentIndex === -1) return;

    const newIndex = currentIndex + direction;

    // Check bounds (don't go before start or after end)
    if (newIndex >= 0 && newIndex < CURRENT_SEASON_GAMES.length) {
        const nextGame = CURRENT_SEASON_GAMES[newIndex];
        
        // Load the new game
        loadGameView(nextGame.gameId);

        // Sync the dropdowns (UX prettied up)
        // If we cross into new month update the Month dropdown
        const monthStr = nextGame.date.substring(0, 7);
        const monthSelect = document.getElementById('monthSelect');
        
        if (monthSelect.value !== monthStr) {
            monthSelect.value = monthStr;
            filterGamesByMonth(monthStr); // This repopulates the game dropdown
        }

        // Update the specific game dropdown to match what we are seeing
        const gameSelect = document.getElementById('gameSelect');
        if (gameSelect) {
            gameSelect.value = nextGame.gameId;
        }
    } else {
        console.log("Navigation boundary reached (Start or End of season).");
    }
}

// --- API 1: PLAYER SEARCH ---
async function fetchPlayerRotation(name) {
    //LeBron Error
    const normalizedName = name; //just use the name as is, no more hardcoded exceptions
    //try to remember why we normalized the name in the first place, maybe we wanted to remove accents or something? but for now let's just use the raw input and see if it works better with the database
    console.log(`Searching for: ${normalizedName}`);
    try {
        const response = await fetch(`${BASE_URL}/api-players-career`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_KEY}` },
            body: JSON.stringify({ playerName: normalizedName })
        });
        
        const career = await response.json();

        if (career && career.games && career.games.length > 0) {
            const g = career.games[0];
            
            // Get Team & Year from Database
            const teamAbbr = g.home_team_abbr || "BOS"; 
            const seasonYear = g.year || 2022; 

            console.log(`Found Player. Loading ${teamAbbr} ${seasonYear}`);

            // Update Inputs
            document.getElementById('teamSelect').value = teamAbbr;
            document.getElementById('yearInput').value = seasonYear;

            // Load Sidebar
            await fetchSeasonAndSetupDropdowns(teamAbbr, seasonYear);

            // Load Chart
            loadGameView(g.game_id);
        } else {
            alert("Player not found.");
        }
    } catch (err) { console.error(err); }
}

// --- API 2: LOAD SEASON ---
async function fetchSeasonAndSetupDropdowns(teamAbbr, year) {
    console.log(`Loading Sidebar: ${teamAbbr} ${year}`);
    try {
        const response = await fetch(`${BASE_URL}/api-team-season`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_KEY}` },
            body: JSON.stringify({ teamAbbr: teamAbbr, year: Number(year)})
        });
        
        const data = await response.json();
        CURRENT_SEASON_GAMES = data.gameTimeline || [];
        //wrong data structure, need to update the backend to return wl in the same object as record and team_name for easier access, but for now let's just check if data.wl exists and log it
        if (data.wl) {
            console.log("datawl ", data.wl);
            const homeWin  = data.wl.homew;
            const awayWin  = data.wl.awayw;
            const homeLoss = data.wl.homel;
            const awayLoss = data.wl.awayl;
            console.log(`NEW Rendering Chart: Home winloss 1st ${data.wl} ${homeWin}-${homeLoss} | Away ${awayWin}-${awayLoss}`);
        }
        // Update Stats Header
        const statsCard = document.getElementById('home-stats-card');
        if (data.record) {
             statsCard.innerHTML = `
                <div class="stats-header">
                    <strong>${NBA_TEAMS[data.team_name]?.name || data.team_name}</strong>
                    <span class="${data.record.wins > data.record.losses ? 'pos' : 'neg'}">
                    <!-- We can also color code the record based on if it's a winning or losing record -->
                        <!-- ${data.record.wins}W - ${data.record.losses}L -->
                    </span>
                </div>`;
        }

        // Setup Month Dropdown
        const monthSelect = document.getElementById('monthSelect');
        monthSelect.innerHTML = `<option value="" disabled selected>2. Select Month</option>`;
        monthSelect.disabled = false;
        
        const months = [...new Set(CURRENT_SEASON_GAMES.map(g => g.date.substring(0, 7)))].sort();
        months.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m;
            opt.textContent = m;
            monthSelect.appendChild(opt);
        });

        // Render Sidebar List
        const gameCard = document.getElementById('game-stats-card');
        if (CURRENT_SEASON_GAMES.length > 0) {
            gameCard.innerHTML = `
                <div style="position:sticky; top:0; background:#1e293b; padding:10px 0; border-bottom:1px solid #333; margin-top:-10px; z-index:5;">
                    <h3 style="margin:0;">${year} - ${Number(year)+1} Season Log</h3>
                </div>
                <div id="game-list-scroll" style="max-height: 400px; overflow-y: auto;"></div>
            `;
            const listContainer = document.getElementById('game-list-scroll');
            
            CURRENT_SEASON_GAMES.forEach(g => {
                const row = document.createElement('div');
                row.style.cursor = 'pointer';
                row.style.padding = '8px 5px';
                row.style.borderBottom = '1px solid #333';
                row.style.fontSize = '0.9em';
                
                const scoreStr = (g.homeScore > 0)
                    ? `${g.awayTeamAbbr} ${g.awayScore} @ ${g.homeTeamAbbr} ${g.homeScore}`
                    : `${g.awayTeamAbbr} @ ${g.homeTeamAbbr}`;

                row.innerHTML = `
                    <div style="display:flex; justify-content:space-between;">
                        <span style="color:#ccc;">${g.date}</span>
                        <span class="${g.result === 'W' ? 'pos' : g.result === 'L' ? 'neg' : ''}" style="font-weight:bold;">${g.result}</span>
                    </div>
                    <div style="margin-top:2px;">${scoreStr}</div>
                `;
                row.onclick = () => loadGameView(g.gameId);
                listContainer.appendChild(row);
            });
            // Scroll to bottom (latest games)
            listContainer.scrollTop = listContainer.scrollHeight;
        } else {
            gameCard.innerHTML = `<div style="padding:20px;">No games found for this season.</div>`;
        }
    } catch (e) { console.error(e); }
}

// --- HELPER: FILTER GAMES ---
function filterGamesByMonth(monthYYYYMM) {
    const gameSelect = document.getElementById('gameSelect');
    gameSelect.innerHTML = `<option value="" disabled selected>3. Select Game</option>`;
    gameSelect.disabled = false;
    document.getElementById('loadGameBtn').disabled = false;

    const filteredGames = CURRENT_SEASON_GAMES.filter(g => g.date.startsWith(monthYYYYMM));
    filteredGames.forEach(g => {
        const opt = document.createElement('option');
        opt.value = g.gameId; 
        const result = g.result || '-';
        const opponent = g.homeTeamAbbr === document.getElementById('teamSelect').value ? g.awayTeamAbbr : g.homeTeamAbbr;
        const vsAt = g.homeTeamAbbr === document.getElementById('teamSelect').value ? 'vs' : '@';
        opt.textContent = `${g.date}: ${vsAt} ${opponent} (${result})`;
        gameSelect.appendChild(opt);
    });
}

// --- API 3: LOAD CHART ---
async function loadGameView(gameId) {
    console.log(`Loading Game View: ${gameId} for debugging`);
    // --- NEW: UPDATE CURRENT GLOBAL ID ---
    CURRENT_GAME_ID = gameId;
    const chartContainer = document.getElementById('chart');
    const statsCard = document.getElementById('home-stats-card');
    
    chartContainer.innerHTML = `<p style="text-align:center; padding:50px; color:#999;">Loading...</p>`;
    
    try {
        const response = await fetch(`${BASE_URL}/api-game-full-rotation`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_KEY}` },
            body: JSON.stringify({ gameId: gameId })
        });
        const data = await response.json();

        // Handle Score Header
        const hasScore = data.Meta && (data.Meta.home_score > 0 || data.Meta.away_score > 0);
        
        if (hasScore) {
            const hScore = data.Meta.home_score;
            const aScore = data.Meta.away_score;
            const hAbbr = data.Meta.home_team_abbr || "HOME";
            const aAbbr = data.Meta.away_team_abbr || "AWAY";
            
            statsCard.innerHTML = `
                <div class="stats-header" style="text-align:center;">
                    <strong style="font-size:1.6em;">${aAbbr} ${aScore} @ ${hAbbr} ${hScore}</strong>
                </div>`;
        } else {
            statsCard.innerHTML = `
                <div class="stats-header" style="text-align:center; color: #f87171;">
                    <strong>No score</strong>
                </div>`;
        }

        // Handle Rotation Chart
        const hasRotation = (data.HomeTeam && data.HomeTeam.length > 0) || (data.AwayTeam && data.AwayTeam.length > 0);
        
        if (hasRotation) {
            renderGameChart(data);
        } else {
            chartContainer.innerHTML = `
                <div style="text-align:center; padding:100px; color: #f87171; font-size: 1.2em;">
                    <strong>No rotation</strong>
                </div>`;
        }
        
    } catch (e) { 
        console.error(e);
        chartContainer.innerHTML = `<p style="text-align:center; color:red;">Error loading game data.</p>`;
    }
}

// --- D3 RENDERER ---
function renderGameChart(data) {
    const container = document.getElementById('chart');
    if (!container) return;
    container.innerHTML = ""; 


    // --- NEW - UPDATE HEADER WITH SCORE ---
    const statsCard = document.getElementById('home-stats-card');
    if (statsCard && data.Meta) {
        // Determine if selected team won
        const selectedTeam = document.getElementById('teamSelect').value;
        const homeScore = data.Meta.home_score;
        const awayScore = data.Meta.away_score;
        const homeAbbr = data.Meta.home_team_abbr || "HOME";
        const awayAbbr = data.Meta.away_team_abbr || "AWAY";
        const homeFullName = NBA_TEAMS.find(t => t.code === homeAbbr)?.name || homeAbbr;
        const awayFullName = NBA_TEAMS.find(t => t.code === awayAbbr)?.name || awayAbbr;
        console.log(`Rendering Header: ${homeAbbr} ${homeFullName} vs ${awayAbbr} ${awayFullName}`);
        const homePart = `<span class="text-nba-blue">${homeFullName}</span>`;
        const awayPart = `<span class="text-nba-red">${awayFullName}</span>`;

        //let displayScore = `${data.Meta.away_team_abbr} ${awayScore} @ ${data.Meta.home_team_abbr} ${homeScore}`;
        let displayScore = `${awayFullName} @ ${homeFullName}`;
        //let scoreColor = "#fff"; // Default white

        // Color code based on if the SELECTED team is home or away. Away = red. Home = Blue
        console.log(`Selected Team: ${selectedTeam} | Home: ${homeAbbr} (${homeScore}) vs Away: ${awayAbbr} (${awayScore})`);
        //if (selectedTeam === data.Meta.home_team_abbr) {
            //scoreColor = "#1d428a"; // Green if selected team is home and won
        //} else if (selectedTeam === data.Meta.away_team_abbr) {
            //scoreColor = "#f87171";
        //}
        //convert from iso to mm/dd/yyyy
        const fixedDate = isoTo(data.Meta.date);
        mobileDate.textContent = `Game Date: ${fixedDate}`;
        console.log(`Game Date: ${data.Meta.date} | Formatted: ${fixedDate}`);
        statsCard.innerHTML = `
            <div class="stats-header" style="text-align:center;">
                <div style="font-size:0.9em; color:#ccc; margin-bottom:4px;">${data.Meta.date || "Game Score"}</div>
                <style="font-size:1.4em;> 
                    ${awayPart} <span style="color:#ccc;">@</span> ${homePart}
                </strong>
            </div>
        `;
    }
    // -------------------------------------
    //THE CHART
    const margin = { top: 40, right: 20, bottom: 50, left: 150 };
    const width = (container.clientWidth || 1000) - margin.left - margin.right;
    const homeTeam = data.HomeTeam || [];
    const awayTeam = data.AwayTeam || [];

    if (homeTeam.length === 0 && awayTeam.length === 0) {
        container.innerHTML = `<p style="text-align:center; padding:50px;">No rotation data available.</p>`;
        return;
    }

    const getPlayers = (d) => [...new Set(d.map(p => `${p.PLAYER_FIRST} ${p.PLAYER_LAST}`))];
    const allPlayers = [...getPlayers(homeTeam), ...getPlayers(awayTeam)];
    const height = Math.max(500, allPlayers.length * 30);

    const svg = d3.select("#chart").append("svg")
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom)
        //.attr("style", "outline: thin solid red;") //outline around chart
        .append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    const x = d3.scaleLinear().domain([0, 2880]).range([0, width]);
    const y = d3.scaleBand().domain(allPlayers).range([0, height]).padding(0.2);
    const xAxis = d3.axisBottom(x)
        .tickValues([0, 720, 1440, 2160, 2880])
        .tickFormat(d => {
            if (d === 0) return "Start";
            const q = d/720; return q <= 4 ? `Q${q}` : `OT${q-4}`;
        });

    svg.append("g").attr("transform", `translate(0,${height})`).call(xAxis);
    svg.append("g").call(d3.axisLeft(y));
    [720, 1440, 2160, 2880].forEach(val => {
        svg.append("line").attr("x1",x(val)).attr("x2",x(val)).attr("y1",0).attr("y2",height)
           .attr("stroke","#ccc").attr("stroke-dasharray","4");
    });
    const color = d3.scaleOrdinal().domain(["Home","Away"]).range(["#1d428a","#ce1141"]);
    const tooltip = d3.select("body").append("div").attr("class","tooltip").style("opacity",0).style("position","absolute").style("background","rgba(0,0,0,0.9)").style("color","white").style("padding","8px").style("border-radius","4px").style("pointer-events","none").style("z-index","1000");
    //const border = svg.append("rect").attr("x",0).attr("y",0).attr("width",width).attr("height",height).attr("fill","none").attr("stroke","#333").attr("stroke-width",1);
    const drawBars = (teamData, type) => {
        svg.selectAll(`.bar-${type}`).data(teamData).enter().append("rect")
            .attr("x", d => {
                const val = parseFloat(d.IN_TIME_REAL);
                return x(val > 3000 ? val/10 : val);
            })
            .attr("y", d => y(`${d.PLAYER_FIRST} ${d.PLAYER_LAST}`))
            .attr("width", d => {
                let s = parseFloat(d.IN_TIME_REAL), e = parseFloat(d.OUT_TIME_REAL);
                if(s>3000) s/=10; if(e>3000) e/=10;
                return Math.max(2, x(e) - x(s));
            })
            .attr("height", y.bandwidth())
            .attr("fill", color(type))
            .on("mouseover", (e, d) => {
                let s = parseFloat(d.IN_TIME_REAL), end = parseFloat(d.OUT_TIME_REAL);
                if(s>3000) s/=10; if(end>3000) end/=10;
                tooltip.style("opacity",1).html(`
                    <strong>${d.PLAYER_FIRST} ${d.PLAYER_LAST}</strong><br/>
                    ${Math.floor(s/60)}:${Math.floor(s%60).toString().padStart(2,'0')} - 
                    ${Math.floor(end/60)}:${Math.floor(end%60).toString().padStart(2,'0')}<br/>
                    PTS: ${d.PLAYER_PTS}
                `).style("left",(e.pageX+10)+"px").style("top",(e.pageY-28)+"px");
            })
            .on("mouseout", () => tooltip.style("opacity",0));
    };
    drawBars(homeTeam, "Home");
    drawBars(awayTeam, "Away");
    document.getElementById('legend').innerHTML = `
        <div style="display:flex; gap:20px; font-size:0.9em;">
            <div style="display:flex; align-items:center;"><div style="width:12px; height:12px; background:#1d428a; margin-right:6px;"></div>${data.Meta.home_team_abbr} (Home)</div>
            <div style="display:flex; align-items:center;"><div style="width:12px; height:12px; background:#ce1141; margin-right:6px;"></div>${data.Meta.away_team_abbr} (Away)</div>
        </div>`;
}
function isoTo(isoString) {  
  const date = new Date(isoString);  
 
  // Check if the date is valid  
  if (isNaN(date.getTime())) {  
    throw new Error("Invalid ISO date string");  
  }  
 
  const day = String(date.getDate()).padStart(2, "0"); // 1 → "01", 15 → "15"  
  const day1 = String(Number(String(date.getDate())) + 1);
  console.log("Day: ", day, " | Day1: ", day1);
  const month = String(date.getMonth() + 1).padStart(2, "0"); // 0 → "01" (January)  
  const year = date.getFullYear();
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];  
  const monthName = months[date.getMonth()];
  return `${monthName} ${day1}, ${year}`;  
} 
//Michael Murdoch 2026