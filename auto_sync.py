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
    """Log into Drexel Learn via Microsoft Azure AD SSO + SAML."""
    print("Logging into Drexel Learn via Microsoft SSO...")

    # Step 1: Hit Blackboard's SSO login endpoint to trigger Microsoft redirect
    sso_urls = [
        f"{DREXEL_LEARN}/auth-saml/saml/login?apId=_1_1",
        f"{DREXEL_LEARN}/webapps/bb-auth-provider-shibboleth-BBLEARN/execute/shibbolethLogin",
        f"{DREXEL_LEARN}/webapps/login/?action=sso_login",
    ]

    resp = None
    for sso_url in sso_urls:
        try:
            print(f"  Trying SSO endpoint: {sso_url}")
            resp = session.get(sso_url, allow_redirects=True, timeout=30)
            print(f"  Redirected to: {resp.url}")
            if "microsoftonline.com" in resp.url or "login.microsoft" in resp.url:
                break
            if "login" in resp.url.lower() and resp.url != sso_url:
                break
        except Exception as e:
            print(f"  Error: {e}")
            continue

    if resp is None:
        # Fallback: try the main page
        resp = session.get(DREXEL_LEARN, allow_redirects=True, timeout=30)
        print(f"  Fallback redirected to: {resp.url}")

    # Step 2: Microsoft login flow
    if "microsoftonline.com" in resp.url or "login.microsoft" in resp.url:
        resp = microsoft_login(session, resp, username, password)
        if resp is None:
            return False
    elif "login" in resp.url.lower():
        resp = generic_form_login(session, resp, username, password)
        if resp is None:
            return False
    else:
        # Check if actually logged in by looking for course content
        if "logout" in resp.text.lower() or "sign out" in resp.text.lower():
            print("  Already logged in!")
            return True
        print("  Not redirected to login - trying direct SSO...")
        resp = generic_form_login(session, resp, username, password)
        if resp is None:
            return False

    # Step 3: Handle SAML response back to Blackboard
    soup = BeautifulSoup(resp.text, "html.parser")
    saml_input = soup.find("input", {"name": "SAMLResponse"})
    if saml_input:
        print("  Processing SAML response back to Blackboard...")
        form = saml_input.find_parent("form")
        if form:
            action = form.get("action", "")
            post_data = {}
            for inp in form.find_all("input"):
                n = inp.get("name", "")
                if n:
                    post_data[n] = inp.get("value", "")
            resp = session.post(action, data=post_data, allow_redirects=True, timeout=30)
            print(f"  SAML callback result: {resp.url}")

    # Verify login
    if resp.status_code == 200 and "login" not in resp.url.lower():
        print("  Login successful!")
        return True

    # One more try: follow any remaining redirects
    resp = session.get(DREXEL_LEARN, allow_redirects=True, timeout=30)
    if resp.status_code == 200 and "login" not in resp.url.lower():
        print("  Login successful!")
        return True

    print("  Login failed.")
    return False


def microsoft_login(session, resp, username, password):
    """Handle Microsoft Azure AD login flow."""
    from urllib.parse import urljoin

    soup = BeautifulSoup(resp.text, "html.parser")

    # Microsoft login has a multi-step process:
    # 1. Enter username
    # 2. Enter password

    # Extract config from page JavaScript
    config_match = re.search(r'\$Config\s*=\s*({.*?});', resp.text, re.DOTALL)
    if not config_match:
        config_match = re.search(r'"urlPost"\s*:\s*"([^"]+)"', resp.text)

    # Step 1: Submit username
    post_url = ""
    if config_match:
        try:
            # Try to extract urlPost from config
            url_match = re.search(r'"urlPost"\s*:\s*"([^"]+)"', resp.text)
            if url_match:
                post_url = url_match.group(1)
        except Exception:
            pass

    if not post_url:
        # Fallback: look for form action
        form = soup.find("form")
        if form:
            post_url = form.get("action", resp.url)
        else:
            post_url = resp.url

    if not post_url.startswith("http"):
        post_url = urljoin(resp.url, post_url)

    # Extract hidden fields
    flow_token = ""
    ctx = ""
    ft_match = re.search(r'"sFT"\s*:\s*"([^"]+)"', resp.text)
    ctx_match = re.search(r'"sCtx"\s*:\s*"([^"]+)"', resp.text)
    if ft_match:
        flow_token = ft_match.group(1)
    if ctx_match:
        ctx = ctx_match.group(1)

    # Submit username
    print("  Submitting username to Microsoft...")
    login_data = {
        "login": username,
        "loginfmt": username,
        "type": "11",
        "LoginOptions": "3",
        "passwd": password,
        "flowtoken": flow_token,
        "ctx": ctx,
        "canary": "",
        "i13": "0",
        "i2": "",
        "i17": "",
        "i18": "",
        "i19": "0",
    }

    # Also try extracting canary
    canary_match = re.search(r'"canary"\s*:\s*"([^"]+)"', resp.text)
    if canary_match:
        login_data["canary"] = canary_match.group(1)

    resp = session.post(post_url, data=login_data, allow_redirects=True, timeout=30)
    print(f"  Microsoft response URL: {resp.url}")

    # Check if we need to submit password separately (some flows)
    if "passwd" not in str(login_data) or "login.microsoftonline" in resp.url:
        soup = BeautifulSoup(resp.text, "html.parser")

        # Re-extract tokens for password step
        ft_match = re.search(r'"sFT"\s*:\s*"([^"]+)"', resp.text)
        ctx_match = re.search(r'"sCtx"\s*:\s*"([^"]+)"', resp.text)
        url_match = re.search(r'"urlPost"\s*:\s*"([^"]+)"', resp.text)

        if ft_match and url_match:
            post_url = url_match.group(1)
            if not post_url.startswith("http"):
                post_url = urljoin(resp.url, post_url)

            print("  Submitting password to Microsoft...")
            pass_data = {
                "login": username,
                "loginfmt": username,
                "passwd": password,
                "type": "11",
                "LoginOptions": "3",
                "flowtoken": ft_match.group(1),
                "ctx": ctx_match.group(1) if ctx_match else "",
                "canary": "",
                "i2": "1",
                "i13": "0",
                "i17": "",
                "i18": "",
                "i19": "0",
            }
            canary_match = re.search(r'"canary"\s*:\s*"([^"]+)"', resp.text)
            if canary_match:
                pass_data["canary"] = canary_match.group(1)

            resp = session.post(post_url, data=pass_data, allow_redirects=True, timeout=30)
            print(f"  Password response URL: {resp.url}")

    # Handle "Stay signed in?" prompt
    if "kmsi" in resp.url.lower() or "stay signed in" in resp.text.lower():
        print("  Handling 'Stay signed in' prompt...")
        ft_match = re.search(r'"sFT"\s*:\s*"([^"]+)"', resp.text)
        ctx_match = re.search(r'"sCtx"\s*:\s*"([^"]+)"', resp.text)
        url_match = re.search(r'"urlPost"\s*:\s*"([^"]+)"', resp.text)

        if url_match:
            kmsi_url = url_match.group(1)
            if not kmsi_url.startswith("http"):
                kmsi_url = urljoin(resp.url, kmsi_url)
            kmsi_data = {
                "LoginOptions": "1",
                "type": "28",
                "flowtoken": ft_match.group(1) if ft_match else "",
                "ctx": ctx_match.group(1) if ctx_match else "",
            }
            resp = session.post(kmsi_url, data=kmsi_data, allow_redirects=True, timeout=30)
            print(f"  KMSI response URL: {resp.url}")

    # Check for errors
    if "error" in resp.text.lower() and "microsoftonline" in resp.url:
        err_match = re.search(r'"strServiceExceptionMessage"\s*:\s*"([^"]+)"', resp.text)
        if err_match:
            print(f"  Microsoft error: {err_match.group(1)}")
        return None

    return resp


def generic_form_login(session, resp, username, password):
    """Fallback: find and submit any login form."""
    from urllib.parse import urljoin
    soup = BeautifulSoup(resp.text, "html.parser")

    for form in soup.find_all("form"):
        if not form.find("input", {"type": "password"}):
            continue

        action = form.get("action", resp.url)
        if not action.startswith("http"):
            action = urljoin(resp.url, action)

        form_data = {}
        for inp in form.find_all("input"):
            name = inp.get("name", "")
            itype = inp.get("type", "")
            if not name:
                continue
            if itype == "password":
                form_data[name] = password
            elif itype in ("text", "email"):
                form_data[name] = username
            else:
                form_data[name] = inp.get("value", "")

        print(f"  Submitting form to: {action}")
        resp = session.post(action, data=form_data, allow_redirects=True, timeout=30)
        if resp.status_code == 200:
            return resp

    return None


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
