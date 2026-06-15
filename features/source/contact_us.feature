Feature: Form submission on Customer Care

  Background:
    Given I am a user on the the Customer Care page
  
  @BATD 
  Scenario: Contact us submission on customer care page
    Given the user has loaded the test data from the confluence page "Automation Test Data" and find the test data "Contact Us Form – Test Data"
    And the user navigates to Contact Us
    When the user fills Title from test data
    And the user fills first name from test data
    And the user fills last name from test data
    And the user fills email address from test data
    And the user fills phone number from test data
    And the user fills postcode from test data
    And user fills Own Hyundai from test data
    And user fills Model of interest from test data
    And user fills Enquiry About from test data
    And user fills Outline Enquiry from test data
    And the user accepts consent checkbox 1
    And the user accepts consent checkbox 2
    And the user clicks Send Enquiry
    Then the Contact us form submission is successful
    And it will return status code 200 in the API
    And a "Thank you" confirmation message should be displayed