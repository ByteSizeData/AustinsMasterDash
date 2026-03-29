#!/usr/bin/env python3
"""
Austin's Master Dash — Automated Drexel Learn Sync
Runs as a GitHub Action every 6 hours.
Logs into Drexel Learn (Blackboard) and scrapes all assignments.
"""

import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path

import requests
from bs4 import BeautifulSoup

DREXEL_LEARN = "https://learn.dcollege.net"
TASKS_FILE = Path(__file__).parent / "tasks.json"


def login(session, username, password):
    """Log into Drexel Learn via SSO."""
    print("Logging into Drexel Learn...")

    # Step 1: Hit Drexel Learn to get redirected to SSO
    resp = session.get(DREXEL_LEARN, allow_redirects=True, timeout=30)

    # Step 2: Find and submit the login form
    soup = BeautifulSoup(resp.text, "html.parser")

    # Look for login form - handle various SSO providers
    form = soup.find("form", {"id": "loginForm"}) or soup.find("form", {"name": "loginForm"})
    if not form:
        # Try finding any form with username/password fields
        for f in soup.find_all("form"):
            if f.find("input", {"type": "password"}):
                form = f
                break

    if not form:
        # Maybe we're already on Blackboard's login page
        form = soup.find("form", {"id": "login"}) or soup.find("form", {"action": re.compile(r"login", re.I)})

    if not form:
        # Check if we're already logged in
        if "logout" in resp.text.lower() or "signout" in resp.text.lower():
            print("  Already logged in!")
            return True
        print("  Could not find login form.")
        print(f"  Current URL: {resp.url}")
        # Try direct Blackboard login
        return try_direct_login(session, username, password, resp.url)

    # Get form action URL
    action = form.get("action", "")
    if not action:
        action = resp.url
    elif not action.startswith("http"):
        from urllib.parse import urljoin
        action = urljoin(resp.url, action)

    # Build form data
    form_data = {}
    for inp in form.find_all("input"):
        name = inp.get("name", "")
        value = inp.get("value", "")
        if name:
            form_data[name] = value

    # Fill in credentials - try common field names
    username_fields = ["username", "j_username", "user_id", "userId", "login", "email", "UserName"]
    password_fields = ["password", "j_password", "passwd", "pass", "Password"]

    for field in username_fields:
        if field in form_data or form.find("input", {"name": field}):
            form_data[field] = username
            break
    else:
        # Try by type
        user_input = form.find("input", {"type": "text"}) or form.find("input", {"type": "email"})
        if user_input and user_input.get("name"):
            form_data[user_input["name"]] = username

    for field in password_fields:
        if field in form_data or form.find("input", {"name": field}):
            form_data[field] = password
            break
    else:
        pass_input = form.find("input", {"type": "password"})
        if pass_input and pass_input.get("name"):
            form_data[pass_input["name"]] = password

    # Submit login form
    print(f"  Submitting login to: {action}")
    resp = session.post(action, data=form_data, allow_redirects=True, timeout=30)

    # Check for SAML response (common with university SSO)
    soup = BeautifulSoup(resp.text, "html.parser")
    saml_form = soup.find("form", {"method": "post"})
    if saml_form:
        saml_input = saml_form.find("input", {"name": "SAMLResponse"})
        if saml_input:
            print("  Processing SAML response...")
            saml_action = saml_form.get("action", "")
            saml_data = {}
            for inp in saml_form.find_all("input"):
                name = inp.get("name", "")
                value = inp.get("value", "")
                if name:
                    saml_data[name] = value
            resp = session.post(saml_action, data=saml_data, allow_redirects=True, timeout=30)

    # Check if login succeeded
    if "login" in resp.url.lower() and "error" in resp.text.lower():
        print("  Login failed - check credentials")
        return False

    # Follow any remaining redirects to Blackboard
    if "learn.dcollege.net" not in resp.url:
        resp = session.get(DREXEL_LEARN, allow_redirects=True, timeout=30)

    print(f"  Login result URL: {resp.url}")
    if resp.status_code == 200:
        print("  Login successful!")
        return True

    return False


def try_direct_login(session, username, password, current_url):
    """Try direct Blackboard login as fallback."""
    print("  Trying direct Blackboard login...")

    login_urls = [
        f"{DREXEL_LEARN}/webapps/login/",
        f"{DREXEL_LEARN}/webapps/bb-auth-provider-shibboleth-BBLEARN/execute/shibbolethLogin",
        f"{DREXEL_LEARN}/auth-saml/saml/login?apId=_1_1",
    ]

    for url in login_urls:
        try:
            resp = session.get(url, allow_redirects=True, timeout=15)
            soup = BeautifulSoup(resp.text, "html.parser")
            form = soup.find("form")
            if form and form.find("input", {"type": "password"}):
                action = form.get("action", resp.url)
                if not action.startswith("http"):
                    from urllib.parse import urljoin
                    action = urljoin(resp.url, action)

                form_data = {}
                for inp in form.find_all("input"):
                    name = inp.get("name", "")
                    if name:
                        form_data[name] = inp.get("value", "")

                # Fill credentials
                for key in form_data:
                    if "user" in key.lower() or "login" in key.lower():
                        form_data[key] = username
                    elif "pass" in key.lower():
                        form_data[key] = password

                resp = session.post(action, data=form_data, allow_redirects=True, timeout=30)
                if resp.status_code == 200 and "login" not in resp.url.lower():
                    print("  Direct login successful!")
                    return True
        except Exception:
            continue

    return False


def get_courses(session):
    """Get list of courses from Blackboard."""
    print("Fetching courses...")
    courses = []

    # Try Blackboard REST API
    api_endpoints = [
        f"{DREXEL_LEARN}/learn/api/v1/users/me/memberships?expand=course&limit=100",
        f"{DREXEL_LEARN}/learn/api/public/v1/users/me/courses?limit=100",
        f"{DREXEL_LEARN}/learn/api/v1/courses?limit=100",
    ]

    for url in api_endpoints:
        try:
            resp = session.get(url, timeout=15)
            if resp.status_code == 200:
                data = resp.json()
                for item in data.get("results", []):
                    course = item.get("course", item)
                    cid = course.get("id", "")
                    name = course.get("name", course.get("displayName", course.get("courseId", "")))
                    if cid and name:
                        courses.append({"id": cid, "name": name})
                if courses:
                    print(f"  Found {len(courses)} courses via API")
                    return courses
        except Exception:
            continue

    # Fallback: scrape the main page
    try:
        resp = session.get(DREXEL_LEARN, timeout=15)
        soup = BeautifulSoup(resp.text, "html.parser")

        # Blackboard Ultra course cards
        for link in soup.select('a[href*="/ultra/courses/"], a[href*="course_id="]'):
            href = link.get("href", "")
            name = link.get_text(strip=True)
            if name and len(name) > 2:
                m = re.search(r'/courses/([^/]+)', href) or re.search(r'course_id=([^&]+)', href)
                cid = m.group(1) if m else ""
                courses.append({"id": cid, "name": name})

        # Blackboard Classic course list
        for el in soup.select('#module\\:_4_1 li a, .courseListing a, [id*="course"] a'):
            name = el.get_text(strip=True)
            href = el.get("href", "")
            if name and len(name) > 2:
                m = re.search(r'course_id=([^&]+)', href) or re.search(r'/courses/([^/]+)', href)
                cid = m.group(1) if m else ""
                courses.append({"id": cid, "name": name})

    except Exception:
        pass

    # Deduplicate
    seen = set()
    unique = []
    for c in courses:
        key = c["name"]
        if key not in seen:
            seen.add(key)
            unique.append(c)

    print(f"  Found {len(unique)} courses")
    return unique


def get_assignments(session, course):
    """Get assignments for a course."""
    assignments = []
    cid = course["id"]
    cname = course["name"]

    if not cid:
        return assignments

    # Try Blackboard REST API endpoints
    endpoints = [
        f"{DREXEL_LEARN}/learn/api/public/v1/courses/{cid}/contents?limit=200",
        f"{DREXEL_LEARN}/learn/api/public/v1/courses/{cid}/gradebook/columns?limit=200",
    ]

    for url in endpoints:
        try:
            resp = session.get(url, timeout=15)
            if resp.status_code != 200:
                continue

            data = resp.json()
            for item in data.get("results", []):
                name = item.get("title", item.get("name", ""))
                if not name or len(name) < 3:
                    continue

                # Get due date
                due_date = ""
                for field in ["due", "dueDate", "grading.due"]:
                    val = item
                    for key in field.split("."):
                        if isinstance(val, dict):
                            val = val.get(key, "")
                        else:
                            val = ""
                    if val:
                        try:
                            d = datetime.fromisoformat(str(val).replace("Z", "+00:00"))
                            due_date = d.strftime("%Y-%m-%dT%H:%M")
                        except (ValueError, TypeError):
                            pass
                        break

                # Check availability dates
                if not due_date:
                    avail = item.get("availability", {})
                    for date_key in ["adaptiveRelease.end", "end"]:
                        val = avail
                        for key in date_key.split("."):
                            if isinstance(val, dict):
                                val = val.get(key, "")
                            else:
                                val = ""
                        if val:
                            try:
                                d = datetime.fromisoformat(str(val).replace("Z", "+00:00"))
                                due_date = d.strftime("%Y-%m-%dT%H:%M")
                            except (ValueError, TypeError):
                                pass

                # Detect type
                handler = item.get("contentHandler", {}).get("id", "").lower()
                task_type = "assignment"
                nl = name.lower()
                if any(w in nl or w in handler for w in ["quiz", "test", "exam", "midterm", "assessment"]):
                    task_type = "quiz"
                elif any(w in nl or w in handler for w in ["discuss", "forum", "board"]):
                    task_type = "discussion"
                elif any(w in nl for w in ["project", "presentation", "group"]):
                    task_type = "project"

                # Skip non-graded content items
                skip = ["folder", "module", "tool", "course/x-bb-toollink"]
                if any(s in handler for s in skip):
                    continue

                assignments.append({
                    "name": name,
                    "course": cname,
                    "dueDate": due_date,
                    "type": task_type,
                    "link": f"{DREXEL_LEARN}/ultra/courses/{cid}/outline",
                })

            if assignments:
                return assignments
        except Exception:
            continue

    # Fallback: try scraping the course page
    try:
        course_url = f"{DREXEL_LEARN}/ultra/courses/{cid}/outline"
        resp = session.get(course_url, timeout=15)
        soup = BeautifulSoup(resp.text, "html.parser")

        for el in soup.select('[class*="assignment"], [class*="activity"], li, tr'):
            text = el.get_text(strip=True)
            if not text or len(text) < 5 or len(text) > 300:
                continue

            lines = text.split("\n")
            name = lines[0].strip()[:150]
            if len(name) < 3:
                continue

            due_date = ""
            date_patterns = [
                r'(\w+ \d{1,2},?\s*\d{4}(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM))?)',
                r'(\d{1,2}/\d{1,2}/\d{2,4})',
            ]
            for pat in date_patterns:
                m = re.search(pat, text, re.I)
                if m:
                    try:
                        d = datetime.strptime(m.group(1).strip(), "%b %d, %Y %I:%M %p")
                        due_date = d.strftime("%Y-%m-%dT%H:%M")
                    except ValueError:
                        try:
                            d = datetime.strptime(m.group(1).strip(), "%B %d, %Y")
                            due_date = d.strftime("%Y-%m-%dT%H:%M")
                        except ValueError:
                            pass
                    break

            nl = name.lower()
            skip_words = ["menu", "navigation", "sign", "log", "home", "help", "search"]
            if any(w in nl for w in skip_words):
                continue

            task_type = "assignment"
            if any(w in nl for w in ["quiz", "exam", "test", "midterm"]):
                task_type = "quiz"
            elif any(w in nl for w in ["discuss", "forum", "post"]):
                task_type = "discussion"
            elif any(w in nl for w in ["project", "group"]):
                task_type = "project"

            assignments.append({
                "name": name,
                "course": cname,
                "dueDate": due_date,
                "type": task_type,
                "link": course_url,
            })
    except Exception:
        pass

    return assignments


def load_tasks():
    """Load existing tasks."""
    if TASKS_FILE.exists():
        try:
            return json.loads(TASKS_FILE.read_text())
        except (json.JSONDecodeError, IOError):
            pass
    return []


def merge_and_save(existing, new_tasks):
    """Merge new tasks, avoiding duplicates, and save."""
    added = 0
    for task in new_tasks:
        exists = any(
            t["name"] == task["name"] and t.get("course") == task["course"]
            for t in existing
        )
        if not exists:
            existing.append({
                "id": f"sync_{int(datetime.now().timestamp())}{added}",
                "name": task["name"],
                "course": task["course"],
                "dueDate": task["dueDate"],
                "type": task["type"],
                "link": task.get("link", ""),
                "hints": "",
                "notes": "",
                "completed": False,
                "createdAt": datetime.now().isoformat(),
            })
            added += 1

    TASKS_FILE.write_text(json.dumps(existing, indent=2))
    return added


def main():
    username = os.environ.get("DREXEL_USERNAME", "")
    password = os.environ.get("DREXEL_PASSWORD", "")

    if not username or not password:
        print("ERROR: DREXEL_USERNAME and DREXEL_PASSWORD must be set")
        print("Add them as GitHub Secrets in your repo settings.")
        sys.exit(1)

    session = requests.Session()
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    })

    # Login
    if not login(session, username, password):
        print("Login failed. Check your credentials.")
        sys.exit(1)

    # Get courses
    courses = get_courses(session)
    if not courses:
        print("No courses found.")
        sys.exit(0)

    for c in courses:
        print(f"  Course: {c['name']}")

    # Get assignments from each course
    all_assignments = []
    for course in courses:
        print(f"Scraping: {course['name']}...")
        assignments = get_assignments(session, course)
        print(f"  Found {len(assignments)} items")
        all_assignments.extend(assignments)

    print(f"\nTotal items scraped: {len(all_assignments)}")

    # Merge with existing
    existing = load_tasks()
    added = merge_and_save(existing, all_assignments)
    total = len(existing) + added

    print(f"New tasks added: {added}")
    print(f"Total tasks: {total}")
    print("Sync complete!")


if __name__ == "__main__":
    main()
