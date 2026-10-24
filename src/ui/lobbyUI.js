import { TEAMS, TEAM_SIZE, NAME_LENGTH } from '../match/teams.js';
import { Lineup } from './lineupUI.js';

const el = (tag, className, text) => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
};
const button = (className, text) => Object.assign(el('button', `pill ${className}`, text), { type: 'button' });

// The multiplayer lobby on the start screen: your name, everyone who has
// joined standing in a line-up in their team's colour, the four teams and
// who's on them, Ready, and Start for the host. Once the match is on, just
// your team. Names come from other players, so they only go in as text.
//
// actions: onJoin(name), onTeam(index), onReady(ready), onStart(), onLeave().
export class LobbyUI {
  constructor(root, { name = '', onJoin, onTeam, onReady, onStart, onLeave }) {
    this.root = root;
    root.hidden = false;
    // Buttons and the name box are for the lobby, not for starting to play.
    root.addEventListener('click', (e) => { if (e.target.closest('button, input')) e.stopPropagation(); });

    this.join = el('div', 'lobby-join');
    this.name = Object.assign(el('input'), {
      type: 'text', value: name, maxLength: NAME_LENGTH, placeholder: 'Your name', autocomplete: 'off', spellcheck: false,
    });
    const joinButton = button('', 'Join the lobby');
    const join = () => onJoin(this.name.value.trim());
    joinButton.addEventListener('click', join);
    this.name.addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
    this.join.append(this.name, joinButton);

    this.lineupBox = el('div', 'lobby-lineup');
    const canvas = el('canvas');
    this.lineupBox.append(canvas);
    this.lineup = new Lineup(canvas);

    this.teams = el('div', 'lobby-teams');
    this.teamBoxes = TEAMS.map((team, i) => {
      const box = el('section', 'lobby-team');
      box.style.setProperty('--team', team.color);
      const head = el('header');
      head.append(el('span', 'dot'), el('b', '', team.name), el('small', '', `${team.shore} shore`));
      const list = el('ol');
      const switchTo = button('', `Join ${team.name}`);
      switchTo.addEventListener('click', () => onTeam(i));
      box.append(head, list, switchTo);
      this.teams.append(box);
      return { list, switchTo };
    });

    this.actions = el('div', 'lobby-actions');
    this.ready = button('ready', 'Ready');
    this.ready.addEventListener('click', () => onReady(!this.ready.classList.contains('active')));
    this.start = button('start', 'Start the match');
    this.start.addEventListener('click', onStart);
    this.actions.append(this.ready, this.start);

    this.banner = el('p', 'lobby-banner');
    this.statusLine = el('p', 'lobby-status');
    this.leave = button('leave', 'Back to single-player');
    this.leave.addEventListener('click', onLeave);
    root.append(this.banner, this.join, this.lineupBox, this.teams, this.actions, this.statusLine, this.leave);
    this.lineupBox.hidden = true;
    this.banner.hidden = true;
    this.lastStatus = '';
    this.noticeTimer = null;
  }

  // state: the server's lobby ({ phase, host, players }); me: your socket id.
  render({ phase, host, players }, me) {
    const you = players.find((p) => p.id === me);
    const open = phase === 'lobby';
    this.join.hidden = !open || !!you;
    this.actions.hidden = !open || !you;
    this.showLineup(open && players.length > 0, players, me);
    TEAMS.forEach((team, i) => {
      const { list, switchTo } = this.teamBoxes[i];
      const members = players.filter((p) => p.team === i);
      list.replaceChildren(...(members.length ? members.map((p) => {
        const item = el('li', p.id === me ? 'you' : '');
        const tags = [p.id === host && 'host', p.ready && 'ready'].filter(Boolean).join(' · ');
        item.append(el('span', 'name', p.name), el('span', 'tags', tags));
        return item;
      }) : [el('li', 'empty', 'No one yet')]));
      switchTo.hidden = !open || !you || you.team === i;
      switchTo.disabled = members.length >= TEAM_SIZE;
      switchTo.textContent = switchTo.disabled ? `${team.name} is full` : `Join ${team.name}`;
    });
    if (you) {
      this.ready.classList.toggle('active', you.ready);
      this.ready.textContent = you.ready ? 'Ready ✓' : 'Ready';
      this.start.hidden = you.id !== host;
      this.start.disabled = !players.every((p) => p.ready);
    }
    const ready = players.filter((p) => p.ready).length;
    let text;
    if (!open) text = 'A match is under way. You can join the next one.';
    else if (!you) text = 'Pick a name and join. Teams are evened out as people join.';
    else if (you.id === host) text = ready === players.length ? 'Everyone’s ready. Start when you like.' : `Waiting for everyone to be ready (${ready} of ${players.length}).`;
    else if (you.ready) text = `Waiting for ${players.find((p) => p.id === host)?.name ?? 'the host'} to start the match.`;
    else text = 'Press Ready when you’re set.';
    this.status(text);
  }

  // No game server answered: say so, and offer to try again.
  offline(text, onRetry) {
    this.join.hidden = this.teams.hidden = this.actions.hidden = true;
    this.showLineup(false);
    const retry = button('', 'Try again');
    retry.addEventListener('click', onRetry);
    this.leave.before(retry, ' ');
    this.status(text);
  }

  // The line-up of everyone who has joined, drawn only while it shows.
  showLineup(show, players = [], me = null) {
    this.lineupBox.hidden = !show;
    if (!show) {
      this.lineup.stop();
      return;
    }
    this.lineup.set(players, me);
    this.lineup.start();
  }

  // The match has started: just your team, over Click to play.
  showMatch(team, players) {
    const mates = players.filter((p) => p.team === TEAMS.indexOf(team)).length;
    this.join.hidden = this.teams.hidden = this.actions.hidden = true;
    this.showLineup(false);
    this.banner.hidden = false;
    this.banner.style.setProperty('--team', team.color);
    this.banner.textContent = `Team ${team.name} · ${team.shore} shore · ${mates} of ${players.length} players`;
    this.leave.textContent = 'Leave the match';
    this.status('');
  }

  // What the lobby's waiting for (shown once a notice has had its time).
  status(text) {
    this.lastStatus = text;
    if (this.noticeTimer) return;
    this.statusLine.classList.remove('notice');
    this.statusLine.textContent = text;
  }

  // Something the server turned down, or that went wrong, for a few seconds.
  notice(text, seconds = 4) {
    clearTimeout(this.noticeTimer);
    this.statusLine.classList.add('notice');
    this.statusLine.textContent = text;
    this.noticeTimer = setTimeout(() => {
      this.noticeTimer = null;
      this.status(this.lastStatus);
    }, seconds * 1000);
  }
}
