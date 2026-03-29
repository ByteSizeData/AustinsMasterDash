#!/usr/bin/env python3
"""
Austin's Master Dash — Auto-Sync from Drexel Learn (Blackboard)

This script:
1. Grabs your Chrome cookies for learn.dcollege.net (you must be logged in)
2. Scrapes your assignments, due dates, and course info from Blackboard
3. Updates the dashboard's tasks.json file
4. Optionally pushes to GitHub Pages so the dashboard auto-updates

Usage:
    python3 sync.py           # Sync and update local tasks.json
    python3 sync.py --push    # Sync and push to GitHub Pages
"""

import json
import os
import sys
import re
from datetime import datetime
from pathlib import Path

try:
    import requests
    from bs4 import BeautifulSoup
    import browser_cookie3
except ImportError:
    print("Missing dependencies. Run:")
    print("  pip3 install --user requests beautifulsoup4 browser-cookie3")
    sys.exit(1)

DREXEL_LEARN_URL = "https://learn.dcollege.net"
TASKS_FILE = Path(__file__).parent / "tasks.json"
STORAGE_KEY = "austins_master_dash_tasks"


def get_chrome_cookies():
    """Get cookies from Chrome for Drexel Learn domain."""
    print("Grabbing cookies from Chrome...")
    try:
        cj = browser_cookie3.chrome(domain_name=".dcollege.net")
        return cj
    except Exception as e:
        print(f"Error getting Chrome cookies: {e}")
        print("Make sure you're logged into Drexel Learn in Chrome.")
        print("You may need to close Chrome first on some systems.")
        return None


def fetch_courses(session):
    """Fetch list of courses from Blackboard."""
    print("Fetching your courses...")
    courses = []

    # Try Blackboard Ultra REST API endpoints
    api_urls = [
        f"{DREXEL_LEARN_URL}/learn/api/v1/users/me/memberships?expand=course",
        f"{DREXEL_LEARN_URL}/learn/api/public/v1/users/me/courses",
        f"{DREXEL_LEARN_URL}/webapps/portal/execute/tabs/tabAction?tab_tab_group_id=_1_1",
    ]

    for url in api_urls:
        try:
            resp = session.get(url, timeout=15)
            if resp.status_code == 200:
                # Try JSON API response
                try:
                    data = resp.json()
                    if "results" in data:
                        for item in data["results"]:
                            course = item.get("course", item)
                            courses.append({
                                "id": course.get("id", ""),
                                "courseId": course.get("courseId", ""),
                                "name": course.get("name", course.get("displayName", "")),
                                "url": f"{DREXEL_LEARN_URL}/ultra/courses/{course.get('id', '')}/outline",
                            })
                        if courses:
                            print(f"  Found {len(courses)} courses via API")
                            return courses
                except (json.JSONDecodeError, KeyError):
                    pass

                # Try HTML scraping
                soup = BeautifulSoup(resp.text, "html.parser")
                # Blackboard course links
                for link in soup.select('a[href*="/webapps/blackboard/execute/launcher"], a[href*="/ultra/courses/"]'):
                    href = link.get("href", "")
                    name = link.get_text(strip=True)
                    if name and len(name) > 2:
                        full_url = href if href.startswith("http") else DREXEL_LEARN_URL + href
                        course_id = ""
                        m = re.search(r'course_id=([^&]+)', href) or re.search(r'/courses/([^/]+)', href)
                        if m:
                            course_id = m.group(1)
                        courses.append({
                            "id": course_id,
                            "courseId": course_id,
                            "name": name,
                            "url": full_url,
                        })
                if courses:
                    print(f"  Found {len(courses)} courses via HTML")
                    return courses
        except Exception as e:
            continue

    # Try the main page as fallback
    try:
        resp = session.get(DREXEL_LEARN_URL, timeout=15)
        soup = BeautifulSoup(resp.text, "html.parser")
        for link in soup.find_all("a", href=True):
            href = link["href"]
            name = link.get_text(strip=True)
            if ("course" in href.lower() or "class" in href.lower()) and name and len(name) > 3:
                full_url = href if href.startswith("http") else DREXEL_LEARN_URL + href
                courses.append({
                    "id": "",
                    "courseId": "",
                    "name": name,
                    "url": full_url,
                })
    except Exception:
        pass

    print(f"  Found {len(courses)} courses")
    return courses


def fetch_assignments(session, course):
    """Fetch assignments for a specific course."""
    assignments = []
    course_name = course["name"]
    course_id = course.get("id", "")

    # Try multiple Blackboard endpoints
    endpoints = []
    if course_id:
        endpoints = [
            f"{DREXEL_LEARN_URL}/learn/api/public/v1/courses/{course_id}/contents",
            f"{DREXEL_LEARN_URL}/learn/api/public/v1/courses/{course_id}/gradebook/columns",
            f"{DREXEL_LEARN_URL}/webapps/blackboard/execute/announcement?method=search&course_id={course_id}",
            f"{DREXEL_LEARN_URL}/webapps/assignment/uploadAssignment?course_id={course_id}",
        ]
    endpoints.append(course["url"])

    for url in endpoints:
        try:
            resp = session.get(url, timeout=15)
            if resp.status_code != 200:
                continue

            # Try JSON API
            try:
                data = resp.json()
                items = data.get("results", [])
                for item in items:
                    name = item.get("title", item.get("name", ""))
                    if not name:
                        continue

                    due_date = ""
                    # Check various date fields
                    for date_field in ["due", "dueDate", "end", "endDate"]:
                        ds = item.get(date_field, "")
                        if ds:
                            try:
                                d = datetime.fromisoformat(ds.replace("Z", "+00:00"))
                                due_date = d.strftime("%Y-%m-%dT%H:%M")
                            except (ValueError, TypeError):
                                pass
                            break

                    # Availability dates
                    avail = item.get("availability", {})
                    if not due_date and avail:
                        adapt = avail.get("adaptiveRelease", {})
                        end = adapt.get("end", "")
                        if end:
                            try:
                                d = datetime.fromisoformat(end.replace("Z", "+00:00"))
                                due_date = d.strftime("%Y-%m-%dT%H:%M")
                            except (ValueError, TypeError):
                                pass

                    # Detect type
                    content_type = item.get("contentHandler", {}).get("id", "").lower()
                    task_type = "assignment"
                    if "quiz" in content_type or "test" in content_type or "assessment" in name.lower():
                        task_type = "quiz"
                    elif "discuss" in content_type or "discussion" in name.lower() or "forum" in name.lower():
                        task_type = "discussion"
                    elif "project" in name.lower() or "group" in name.lower():
                        task_type = "project"

                    assignments.append({
                        "name": name,
                        "course": course_name,
                        "dueDate": due_date,
                        "type": task_type,
                        "link": url,
                    })
                if assignments:
                    return assignments
            except (json.JSONDecodeError, KeyError):
                pass

            # Try HTML scraping
            soup = BeautifulSoup(resp.text, "html.parser")

            # Look for assignment-like elements
            selectors = [
                "li.clearfix",  # Blackboard classic
                ".item-link",
                "div[id*='content']",
                "tr",
                ".element-details",
                "[class*='assignment']",
                "[class*='activity']",
            ]

            for sel in selectors:
                for el in soup.select(sel):
                    text = el.get_text(strip=True)
                    if not text or len(text) < 5 or len(text) > 300:
                        continue

                    # Try to extract name and date
                    lines = [l.strip() for l in text.split("\n") if l.strip()]
                    if not lines:
                        continue

                    name = lines[0][:150]
                    due_date = ""

                    # Look for dates in the text
                    date_patterns = [
                        r'(\w+ \d{1,2},?\s*\d{4}(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM))?)',
                        r'(\d{1,2}/\d{1,2}/\d{2,4}(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM))?)',
                        r'((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{1,2}(?:,?\s*\d{4})?)',
                    ]
                    for pattern in date_patterns:
                        m = re.search(pattern, text, re.IGNORECASE)
                        if m:
                            try:
                                d = datetime.strptime(m.group(1), "%b %d, %Y %I:%M %p")
                                due_date = d.strftime("%Y-%m-%dT%H:%M")
                            except ValueError:
                                try:
                                    d = datetime.strptime(m.group(1), "%B %d, %Y")
                                    due_date = d.strftime("%Y-%m-%dT%H:%M")
                                except ValueError:
                                    pass
                            break

                    link_el = el.find("a", href=True)
                    link = ""
                    if link_el:
                        href = link_el["href"]
                        link = href if href.startswith("http") else DREXEL_LEARN_URL + href

                    # Detect type
                    task_type = "assignment"
                    name_lower = name.lower()
                    if any(w in name_lower for w in ["quiz", "exam", "test", "midterm"]):
                        task_type = "quiz"
                    elif any(w in name_lower for w in ["discuss", "forum", "post"]):
                        task_type = "discussion"
                    elif any(w in name_lower for w in ["project", "group", "presentation"]):
                        task_type = "project"

                    # Skip obvious non-assignments
                    skip_words = ["menu", "navigation", "sign", "log", "home", "help", "search", "footer", "header"]
                    if any(w in name_lower for w in skip_words):
                        continue

                    assignments.append({
                        "name": name,
                        "course": course_name,
                        "dueDate": due_date,
                        "type": task_type,
                        "link": link,
                    })

            if assignments:
                return assignments

        except Exception as e:
            continue

    return assignments


def load_existing_tasks():
    """Load existing tasks from tasks.json."""
    if TASKS_FILE.exists():
        try:
            return json.loads(TASKS_FILE.read_text())
        except (json.JSONDecodeError, IOError):
            pass
    return []


def merge_tasks(existing, new_tasks):
    """Merge new tasks with existing, avoiding duplicates."""
    added = 0
    for task in new_tasks:
        # Check for duplicates by name + course
        exists = any(
            t["name"] == task["name"] and t.get("course") == task["course"]
            for t in existing
        )
        if not exists:
            existing.append({
                "id": f"{int(datetime.now().timestamp()*1000)}{added}",
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
    return existing, added


def save_tasks(tasks):
    """Save tasks to tasks.json."""
    TASKS_FILE.write_text(json.dumps(tasks, indent=2))
    print(f"Saved {len(tasks)} tasks to {TASKS_FILE}")


def push_to_github():
    """Push updated tasks.json to GitHub."""
    print("Pushing to GitHub Pages...")
    os.chdir(Path(__file__).parent)
    os.system('git add tasks.json')
    os.system('git commit -m "Auto-sync tasks from Drexel Learn"')
    os.system('git push origin main')
    print("Dashboard updated! Check https://bytesizedata.github.io/AustinsMasterDash/")


def main():
    push = "--push" in sys.argv

    # Get cookies
    cookies = get_chrome_cookies()
    if not cookies:
        sys.exit(1)

    # Create session with cookies
    session = requests.Session()
    session.cookies = cookies
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
    })

    # Test if we're logged in
    print("Testing Drexel Learn connection...")
    try:
        resp = session.get(DREXEL_LEARN_URL, timeout=15, allow_redirects=True)
        if "login" in resp.url.lower() or resp.status_code == 401:
            print("Not logged in! Please log into Drexel Learn in Chrome first, then try again.")
            sys.exit(1)
        print("  Connected successfully!")
    except Exception as e:
        print(f"  Connection failed: {e}")
        sys.exit(1)

    # Fetch courses
    courses = fetch_courses(session)
    if not courses:
        print("No courses found. You may need to log into Drexel Learn in Chrome first.")
        sys.exit(1)

    print(f"\nFound courses:")
    for c in courses:
        print(f"  - {c['name']}")

    # Fetch assignments from each course
    all_assignments = []
    for course in courses:
        print(f"\nScraping: {course['name']}...")
        assignments = fetch_assignments(session, course)
        print(f"  Found {len(assignments)} items")
        all_assignments.extend(assignments)

    if not all_assignments:
        print("\nNo assignments found across any courses.")
        print("This might mean the page structure is different than expected.")
        print("Try using Quick Import on the dashboard instead.")
        sys.exit(0)

    # Load existing and merge
    existing = load_existing_tasks()
    merged, added = merge_tasks(existing, all_assignments)

    print(f"\nSync complete: {added} new tasks added ({len(merged)} total)")

    # Save
    save_tasks(merged)

    # Also generate a JS snippet that can be loaded by the dashboard
    js_file = Path(__file__).parent / "synced-data.js"
    js_file.write_text(
        f"// Auto-generated by sync.py at {datetime.now().isoformat()}\n"
        f"window.__syncedTasks = {json.dumps(all_assignments, indent=2)};\n"
    )

    if push:
        push_to_github()
    else:
        print("\nRun with --push to auto-update the live dashboard.")


if __name__ == "__main__":
    main()
