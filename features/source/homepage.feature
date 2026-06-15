Feature: Hyundai Australia Website - Homepage and Navigation
  As a user visiting the Hyundai Australia website
  I want to browse vehicles, access services, and navigate the site seamlessly
  So that I can explore Hyundai products and make informed decisions

  Background:
    Given the user is on the Hyundai Australia homepage "https://www.hyundai.com/au/en"
    And the page is fully loaded

  # ============================================================
  # HEADER AND NAVIGATION
  # ============================================================

  @header @navigation @smoke
  Scenario: Verify the main header is displayed with Hyundai logo
    Then the Hyundai logo should be displayed in the header
    And the logo should be clickable and redirect to the homepage

  @header @navigation
  Scenario: Verify main navigation menu items are displayed
    Then the following main navigation menu items should be displayed:
      | Menu Item       |
      | Models        |
      | Buying  |
      | Owning         |
      | About   |
  

  @header @navigation
  Scenario: Verify the hamburger menu is displayed on mobile view
    Given the user is viewing the site on a mobile device
    Then the hamburger menu icon should be displayed
    When the user clicks on the hamburger menu icon
    Then the mobile navigation menu should expand

  @header @navigation
  Scenario Outline: Navigate to main menu sections
    When the user clicks the "<menuItem>" menu
    And the user takes a screenshot named "menu-<menuItem>"

    Examples:
      | menuItem |
      | Models   |
      | Buying   |
      | Owning   |
      | About    |

  @header @search
  Scenario: Verify search functionality is available
    When the user clicks on the search icon in the header
    Then the search input field should be displayed
    When the user types "Tucson" in the search field
    And the user submits the search
    Then search results related to "Tucson" should be displayed

  @header @navigation
  Scenario: Verify "Find a Dealer" link is accessible from the header
    When the user clicks on the "Find a Dealer" link in the header
    Then the user should be redirected to the dealer locator page
    When the user enters "2000" in the location field
    And the user selects the first location suggestion
    And the user clicks the "Search" button
    Then the dealer map should be displayed
    And a list of nearby dealers should be displayed

  @header @navigation
  Scenario: Verify "Test Drive" button is accessible from the header
    When the user clicks on the "Book a Test Drive" button in the header
    Then the user should be redirected to the test drive booking page


  # ============================================================
  # FOOTER
  # ============================================================

  @footer @smoke
  Scenario: Verify footer is displayed with all essential links
    When the user scrolls to the footer
    Then the footer should be displayed
    And the footer should contain the following sections:
      | Section          |
      | Vehicles         |
      | Shopping Tools   |
      | Owners           |
      | About Hyundai    |
      | Follow Us        |
      | Legal Links      |

  @footer
  Scenario: Verify social media links in footer
    When the user scrolls to the footer
    Then the following social media icons should be displayed:
      | Social Media |
      | Facebook     |
      | Instagram    |
      | YouTube      |
      | Twitter      |
    And each social media icon should link to the correct Hyundai Australia social page

  @footer
  Scenario: Verify legal links in footer
    When the user scrolls to the footer
    Then the following legal links should be displayed:
      | Legal Link         |
      | Privacy Policy     |
      | Terms of Use       |
      | Cookie Policy      |
      | Sitemap            |
      | Accessibility      |

  @footer
  Scenario Outline: Navigate to footer legal pages
    When the user scrolls to the footer
    And the user clicks on the "<legalLink>" link
    Then the user should be redirected to the "<legalLink>" page

    Examples:
      | legalLink        |
      | Privacy Policy   |
      | Terms of Use     |
      | Cookie Policy    |
      | Sitemap          |

  @footer
  Scenario: Verify copyright notice in footer
    When the user scrolls to the footer
    Then the copyright notice should be displayed
    And it should contain the current year and "Hyundai Motor Company Australia"

  # ============================================================
  # RESPONSIVE DESIGN
  # ============================================================

  @responsive @mobile
  Scenario: Verify homepage renders correctly on mobile devices
    Given the user is viewing the site on a mobile device with width "375" pixels
    Then the page layout should adjust to mobile view
    And the hamburger menu should replace the desktop navigation
    And all images should be properly scaled
    And no horizontal scrollbar should appear

  @responsive @tablet
  Scenario: Verify homepage renders correctly on tablet devices
    Given the user is viewing the site on a tablet device with width "768" pixels
    Then the page layout should adjust to tablet view
    And the navigation should be appropriately displayed
    And all content sections should be visible and properly aligned

  @responsive @desktop
  Scenario: Verify homepage renders correctly on desktop
    Given the user is viewing the site on a desktop with width "1440" pixels
    Then the full desktop navigation should be displayed
    And all content sections should be properly laid out in desktop format

  

  # ============================================================
  # CONTACT US
  # ============================================================

  @contact
  Scenario: Access Contact Us page
    When the user navigates to the "Contact Us" page
    Then the contact information should be displayed including:
      | Contact Method    |
      | Phone Number      |
      | Email Address     |
      | Live Chat         |
      | Contact Form      |

  @contact
  Scenario: Submit a contact form enquiry
    Given the user is on the Contact Us page
    When the user fills in the contact form with:
      | Field       | Value                |
      | Name        | Jaja            |
      | Email       | thetester@orchard.com.au |
      | Phone       | 0412345678           |
      | Subject     | General Enquiry      |
      | Message     | I have a question about the new IONIQ 5 |
    And the user clicks "Submit"
    Then a success message should be displayed confirming the enquiry was received

  # ============================================================
  # LIVE CHAT
  # ============================================================

  @live-chat
  Scenario: Verify live chat widget is available
    Then a live chat widget or icon should be displayed on the page
    When the user clicks on the live chat widget
    Then the chat window should open
    And a welcome message or chatbot prompt should be displayed

  @live-chat
  Scenario: Interact with live chat
    Given the live chat window is open
    When the user types "I want to know about IONIQ 5 pricing"
    And the user sends the message
    Then a response from the chatbot or agent should be received